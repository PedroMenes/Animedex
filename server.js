const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const bcrypt     = require('bcryptjs');
const session    = require('express-session');
const crypto     = require('crypto');
const { createClient } = require('@libsql/client');

const app        = express();
const PORT       = process.env.PORT || 3131;
const DB_FILE    = path.join(__dirname, 'data.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const SECRET_FILE= path.join(__dirname, '.session-secret');

// ── Turso (produção) vs JSON (dev local) ──────────────────────
let turso = null;
if (process.env.TURSO_URL && process.env.TURSO_TOKEN) {
  turso = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
  console.log('[db] usando Turso');
} else {
  console.log('[db] usando JSON local (TURSO_URL não definido)');
}

async function initTurso() {
  if (!turso) return;
  await turso.batch([
    { sql: `CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              username TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              created_at INTEGER NOT NULL
            )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS lists (
              user_id TEXT NOT NULL,
              mal_id  INTEGER NOT NULL,
              data    TEXT NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY (user_id, mal_id)
            )`, args: [] },
    // Tabela própria: no MAL os IDs de anime e mangá são espaços separados
    // (mal_id 21 é One Piece como anime e Death Note como mangá), então
    // guardar os dois em `lists` sobrescreveria um com o outro.
    { sql: `CREATE TABLE IF NOT EXISTS reading (
              user_id TEXT NOT NULL,
              mal_id  INTEGER NOT NULL,
              data    TEXT NOT NULL,
              updated_at INTEGER NOT NULL,
              PRIMARY KEY (user_id, mal_id)
            )`, args: [] },
  ], 'write');
}

// ── JSON fallback helpers (dev local) ────────────────────────
function readDB() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return Array.isArray(raw) ? { _legacy: raw } : raw;
  } catch { return {}; }
}
function writeDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function writeUsers(users) {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(tmp, USERS_FILE);
}

// ── DB abstraction (Turso ou JSON) ────────────────────────────
async function dbGetUser(username) {
  if (turso) {
    const r = await turso.execute({
      sql: 'SELECT id, username, password_hash, created_at FROM users WHERE LOWER(username)=LOWER(?)',
      args: [username],
    });
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return { id: row.id, username: row.username, passwordHash: row.password_hash, createdAt: row.created_at };
  }
  return readUsers().find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
}

async function dbCreateUser(user) {
  if (turso) {
    await turso.execute({
      sql: 'INSERT INTO users (id, username, password_hash, created_at) VALUES (?,?,?,?)',
      args: [user.id, user.username, user.passwordHash, user.createdAt],
    });
    return;
  }
  const users = readUsers();
  users.push(user);
  writeUsers(users);
}

async function dbUsernameExists(username) {
  if (turso) {
    const r = await turso.execute({
      sql: 'SELECT 1 FROM users WHERE LOWER(username)=LOWER(?)',
      args: [username],
    });
    return r.rows.length > 0;
  }
  return readUsers().some(u => u.username.toLowerCase() === username.toLowerCase());
}

async function dbGetList(userId) {
  if (turso) {
    const r = await turso.execute({
      sql: 'SELECT data FROM lists WHERE user_id=? ORDER BY updated_at DESC',
      args: [userId],
    });
    return r.rows.map(row => JSON.parse(row.data));
  }
  return readDB()[userId] || [];
}

async function dbUpsertEntry(userId, entry) {
  if (turso) {
    await turso.execute({
      sql: `INSERT INTO lists (user_id, mal_id, data, updated_at) VALUES (?,?,?,?)
            ON CONFLICT(user_id, mal_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
      args: [userId, entry.malId, JSON.stringify(entry), Date.now()],
    });
    return;
  }
  const db   = readDB();
  const list = db[userId] || [];
  const idx  = list.findIndex(e => e.malId === entry.malId);
  if (idx >= 0) list[idx] = entry; else list.unshift(entry);
  db[userId] = list;
  writeDB(db);
}

async function dbDeleteEntry(userId, malId) {
  if (turso) {
    await turso.execute({
      sql: 'DELETE FROM lists WHERE user_id=? AND mal_id=?',
      args: [userId, malId],
    });
    return;
  }
  const db   = readDB();
  db[userId] = (db[userId] || []).filter(e => e.malId !== malId);
  writeDB(db);
}

// ── Leituras (mangá / light novel) ────────────────────────────
// No fallback JSON, chave própria para não misturar com a lista de anime
const readingKey = userId => `reading:${userId}`;

async function dbGetReading(userId) {
  if (turso) {
    const r = await turso.execute({
      sql: 'SELECT data FROM reading WHERE user_id=? ORDER BY updated_at DESC',
      args: [userId],
    });
    return r.rows.map(row => JSON.parse(row.data));
  }
  return readDB()[readingKey(userId)] || [];
}

async function dbUpsertReading(userId, entry) {
  if (turso) {
    await turso.execute({
      sql: `INSERT INTO reading (user_id, mal_id, data, updated_at) VALUES (?,?,?,?)
            ON CONFLICT(user_id, mal_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`,
      args: [userId, entry.malId, JSON.stringify(entry), Date.now()],
    });
    return;
  }
  const db   = readDB();
  const list = db[readingKey(userId)] || [];
  const idx  = list.findIndex(e => e.malId === entry.malId);
  if (idx >= 0) list[idx] = entry; else list.unshift(entry);
  db[readingKey(userId)] = list;
  writeDB(db);
}

async function dbDeleteReading(userId, malId) {
  if (turso) {
    await turso.execute({
      sql: 'DELETE FROM reading WHERE user_id=? AND mal_id=?',
      args: [userId, malId],
    });
    return;
  }
  const db = readDB();
  db[readingKey(userId)] = (db[readingKey(userId)] || []).filter(e => e.malId !== malId);
  writeDB(db);
}

// ── Session secret ────────────────────────────────────────────
function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s, 'utf8');
  return s;
}

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(session({
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(express.static(__dirname));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

// ── Auth routes ───────────────────────────────────────────────

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
  res.json({ userId: req.session.userId, username: req.session.username });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username?.trim() || !password)
    return res.status(400).json({ error: 'Username e senha obrigatórios' });
  if (username.trim().length < 3)
    return res.status(400).json({ error: 'Username deve ter ao menos 3 caracteres' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Senha deve ter ao menos 4 caracteres' });

  try {
    if (await dbUsernameExists(username.trim()))
      return res.status(409).json({ error: 'Username já em uso' });

    const id           = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    await dbCreateUser({ id, username: username.trim(), passwordHash, createdAt: Date.now() });

    req.session.userId   = id;
    req.session.username = username.trim();
    res.json({ ok: true, username: username.trim() });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Erro interno ao criar conta' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Preencha usuário e senha' });

  try {
    const user = await dbGetUser(username);
    if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Usuário ou senha incorretos' });

    req.session.userId   = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Erro interno ao fazer login' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── Jikan proxy com cache e retry ────────────────────────────
const JIKAN     = 'https://api.jikan.moe/v4';
const cache     = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function jikanFetch(url, retries = 3, delayMs = 1500) {
  const cached = cache.get(url);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(tid);

      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (res.status >= 500) {
        if (attempt < retries - 1) { await new Promise(r => setTimeout(r, delayMs * (attempt + 1))); continue; }
        throw new Error(`Jikan ${res.status}`);
      }

      const data = await res.json();
      cache.set(url, { data, expiresAt: Date.now() + CACHE_TTL });
      return data;
    } catch (err) {
      if (err.name === 'AbortError') console.warn(`[jikan] timeout (tentativa ${attempt + 1})`);
      else console.warn(`[jikan] erro: ${err.message} (tentativa ${attempt + 1})`);
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}

// ── AniList fallback ──────────────────────────────────────────
const JIKAN_GENRE_TO_ANILIST = {
  1:'Action', 2:'Adventure', 4:'Comedy', 8:'Drama', 10:'Fantasy',
  14:'Horror', 7:'Mystery', 22:'Romance', 24:'Sci-Fi', 36:'Slice of Life',
  30:'Sports', 37:'Supernatural', 41:'Thriller',
};

// Campos pedidos em toda query AniList — o mapper abaixo depende de todos eles
const ANILIST_MEDIA_FIELDS = `idMal id type format title { romaji english } coverImage { large }
        episodes averageScore description(asHtml: false) genres duration status
        startDate { year } studios(isMain: true) { nodes { name } }`;

function mapAnilistMedia(media) {
  return media.map(a => ({
    mal_id:   a.idMal || a.id,
    title:    a.title.english || a.title.romaji,
    title_japanese: a.title.romaji,
    images:   { jpg: { image_url: a.coverImage.large, large_image_url: a.coverImage.large } },
    episodes: a.episodes,
    score:    a.averageScore ? +(a.averageScore / 10).toFixed(2) : null,
    synopsis: a.description ? a.description.replace(/<[^>]*>/g, '') : null,
    genres:   (a.genres || []).map(g => ({ name: g })),
    duration: a.duration ? `${a.duration} min per ep` : null,
    studios:  a.studios?.nodes?.[0]?.name ? [{ name: a.studios.nodes[0].name }] : [],
    year:     a.startDate?.year || null,
    status:   a.status,
    _source:  'anilist',
  }));
}

async function anilistByGenre(genreId, page = 1) {
  const genreName = JIKAN_GENRE_TO_ANILIST[genreId];
  if (!genreName) throw new Error(`Gênero ${genreId} sem mapeamento`);
  const gql = `query ($genre: String, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(type: ANIME, genre: $genre, sort: SCORE_DESC) {
        ${ANILIST_MEDIA_FIELDS}
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { genre: genreName, page, perPage: 12 } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message);
  const p = json.data?.Page;
  return { data: mapAnilistMedia(p?.media || []), pagination: { has_next_page: p?.pageInfo?.hasNextPage ?? false } };
}

async function anilistSearch(query) {
  const gql = `query ($search: String, $perPage: Int) {
    Page(perPage: $perPage) {
      media(search: $search, type: ANIME, sort: SCORE_DESC) {
        ${ANILIST_MEDIA_FIELDS}
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { search: query, perPage: 20 } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message);
  return { data: mapAnilistMedia(json.data?.Page?.media || []), pagination: { has_next_page: false } };
}

const WEEKDAYS = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];

// O Jikan reporta broadcast.day no fuso do Japão — o AniList dá só o timestamp
function jstWeekday(airingAt) {
  if (!airingAt) return null;
  return WEEKDAYS[new Date((airingAt + 9 * 3600) * 1000).getUTCDay()];
}

function currentSeason() {
  const now = new Date();
  const m = now.getUTCMonth();
  return {
    season: m < 3 ? 'WINTER' : m < 6 ? 'SPRING' : m < 9 ? 'SUMMER' : 'FALL',
    year: now.getUTCFullYear(),
  };
}

async function anilistSeasonNow(perPage = 25) {
  const { season, year } = currentSeason();
  const gql = `query ($season: MediaSeason, $year: Int, $perPage: Int) {
    Page(perPage: $perPage) {
      media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC) {
        ${ANILIST_MEDIA_FIELDS}
        nextAiringEpisode { airingAt }
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { season, year, perPage } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message);
  const media = json.data?.Page?.media || [];
  const data = mapAnilistMedia(media).map((entry, i) => ({
    ...entry,
    broadcast: { day: jstWeekday(media[i].nextAiringEpisode?.airingAt) },
  }));
  return { data, pagination: { has_next_page: false } };
}

// ── Relacionados (franquia + parecidos) ───────────────────────
// Vai direto ao AniList: traz relações e recomendações numa só consulta,
// e o Jikan precisaria de duas (além de estar fora do ar).
const RELATION_LABELS = {
  SEQUEL:      'Sequência',
  PREQUEL:     'Prequela',
  SIDE_STORY:  'História paralela',
  SPIN_OFF:    'Spin-off',
  ALTERNATIVE: 'Versão alternativa',
  PARENT:      'Obra principal',
  SUMMARY:     'Resumo',
};

// O app inteiro é chaveado por malId — sem ele o card não abre o modal
function usableAnime(node) {
  return !!node && node.type === 'ANIME' && !!node.idMal;
}

function mapRelatedNode(node) {
  return mapAnilistMedia([node])[0];
}

const relatedCache = new Map();

async function anilistRelated(idMal) {
  const gql = `query ($idMal: Int) {
    Media(idMal: $idMal, type: ANIME) {
      relations { edges { relationType node { ${ANILIST_MEDIA_FIELDS} } } }
      recommendations(sort: RATING_DESC, perPage: 10) {
        nodes { mediaRecommendation { ${ANILIST_MEDIA_FIELDS} } }
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { idMal } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message);

  const media = json.data?.Media;
  if (!media) return { franchise: [], similar: [] };

  const franchise = (media.relations?.edges || [])
    .filter(e => RELATION_LABELS[e.relationType] && usableAnime(e.node))
    .map(e => ({ ...mapRelatedNode(e.node), relationLabel: RELATION_LABELS[e.relationType] }));

  const similar = (media.recommendations?.nodes || [])
    .map(n => n.mediaRecommendation)
    .filter(usableAnime)
    .map(mapRelatedNode);

  return { franchise, similar };
}

app.get('/api/related/:malId', async (req, res) => {
  const malId = parseInt(req.params.malId, 10);
  if (!Number.isInteger(malId) || malId <= 0) return res.status(400).json({ error: 'malId inválido' });

  const hit = relatedCache.get(malId);
  if (hit && hit.expiresAt > Date.now()) return res.json(hit.data);

  try {
    const data = await anilistRelated(malId);
    relatedCache.set(malId, { data, expiresAt: Date.now() + CACHE_TTL });
    res.json(data);
  } catch (err) {
    console.warn('[related] falhou:', err.message);
    res.status(502).json({ error: 'relacionados indisponíveis' });
  }
});

app.get('/api/jikan', async (req, res) => {
  const jikanPath = req.query.path;
  if (!jikanPath) return res.status(400).json({ error: 'path required' });

  try {
    const data = await jikanFetch(`${JIKAN}${jikanPath}`);
    return res.json(data);
  } catch (err) {
    console.warn('[jikan] falhou, tentando AniList…', err.message);
  }

  const urlObj   = new URL(jikanPath, 'http://x');
  const q        = urlObj.searchParams.get('q');
  const genreIds = urlObj.searchParams.get('genres');
  const page     = parseInt(urlObj.searchParams.get('page') || '1', 10);

  if (urlObj.pathname.startsWith('/seasons/now')) {
    try { return res.json(await anilistSeasonNow()); }
    catch (e) { console.warn('[anilist] season falhou:', e.message); }
  }
  if (q) {
    try { return res.json(await anilistSearch(q)); }
    catch (e) { console.warn('[anilist] search falhou:', e.message); }
  }
  if (genreIds) {
    try { return res.json(await anilistByGenre(parseInt(genreIds.split(',')[0], 10), page)); }
    catch (e) { console.warn('[anilist] genre falhou:', e.message); }
  }

  res.status(502).json({ error: 'API indisponível no momento. Tente novamente em breve.' });
});

// ── Tradução (en → pt-BR) ─────────────────────────────────────
const translateCache = new Map();

async function translateToPt(text) {
  if (translateCache.has(text)) return translateCache.get(text);

  const body = new URLSearchParams({ client: 'gtx', sl: 'en', tl: 'pt', dt: 't', q: text });
  const res = await fetch('https://translate.googleapis.com/translate_a/single', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`translate ${res.status}`);

  const json = await res.json();
  const out = (json?.[0] || []).map(seg => seg?.[0] || '').join('').trim();
  if (!out) throw new Error('resposta vazia');

  translateCache.set(text, out);
  return out;
}

app.post('/api/translate', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  if (text.length > 6000) return res.status(413).json({ error: 'texto muito longo' });
  try {
    res.json({ text: await translateToPt(text) });
  } catch (err) {
    console.warn('[translate] falhou:', err.message);
    res.status(502).json({ error: 'tradução indisponível' });
  }
});

// ── List API ──────────────────────────────────────────────────

app.get('/api/list', requireAuth, async (req, res) => {
  try {
    res.json(await dbGetList(req.session.userId));
  } catch (err) {
    console.error('[list get]', err);
    res.status(500).json({ error: 'Erro ao carregar lista' });
  }
});

app.post('/api/list', requireAuth, async (req, res) => {
  const entry = req.body;
  if (!entry?.malId) return res.status(400).json({ error: 'malId required' });
  try {
    await dbUpsertEntry(req.session.userId, entry);
    const list = await dbGetList(req.session.userId);
    res.json({ ok: true, total: list.length });
  } catch (err) {
    console.error('[list post]', err);
    res.status(500).json({ error: 'Erro ao salvar entrada' });
  }
});

app.delete('/api/list/:malId', requireAuth, async (req, res) => {
  const malId = +req.params.malId;
  if (!malId) return res.status(400).json({ error: 'invalid malId' });
  try {
    await dbDeleteEntry(req.session.userId, malId);
    const list = await dbGetList(req.session.userId);
    res.json({ ok: true, total: list.length });
  } catch (err) {
    console.error('[list delete]', err);
    res.status(500).json({ error: 'Erro ao remover entrada' });
  }
});

// ── Reading API (mangá / light novel) ─────────────────────────

app.get('/api/reading', requireAuth, async (req, res) => {
  try {
    res.json(await dbGetReading(req.session.userId));
  } catch (err) {
    console.error('[reading get]', err);
    res.status(500).json({ error: 'Erro ao carregar leituras' });
  }
});

app.post('/api/reading', requireAuth, async (req, res) => {
  const entry = req.body;
  if (!entry?.malId) return res.status(400).json({ error: 'malId required' });
  try {
    await dbUpsertReading(req.session.userId, entry);
    const list = await dbGetReading(req.session.userId);
    res.json({ ok: true, total: list.length });
  } catch (err) {
    console.error('[reading post]', err);
    res.status(500).json({ error: 'Erro ao salvar leitura' });
  }
});

app.delete('/api/reading/:malId', requireAuth, async (req, res) => {
  const malId = +req.params.malId;
  if (!malId) return res.status(400).json({ error: 'invalid malId' });
  try {
    await dbDeleteReading(req.session.userId, malId);
    const list = await dbGetReading(req.session.userId);
    res.json({ ok: true, total: list.length });
  } catch (err) {
    console.error('[reading delete]', err);
    res.status(500).json({ error: 'Erro ao remover leitura' });
  }
});

// Vai direto ao AniList: o fallback do proxy Jikan é fixo em type: ANIME
// e devolveria animes numa busca de mangá.
const ANILIST_MANGA_FIELDS = `idMal id type format title { romaji english } coverImage { large }
        chapters volumes averageScore description(asHtml: false) genres status
        startDate { year } staff(perPage: 4) { edges { role node { name { full } } } }`;

function mapAnilistManga(media) {
  return media
    .filter(a => a && a.idMal)
    .map(a => {
      const author = a.staff?.edges?.find(e => /story/i.test(e.role || ''))?.node?.name?.full
                  || a.staff?.edges?.[0]?.node?.name?.full || '';
      return {
        malId:    a.idMal,
        title:    a.title.english || a.title.romaji,
        image:    a.coverImage?.large || '',
        format:   a.format || 'MANGA',
        chapters: a.chapters || 0,
        volumes:  a.volumes || 0,
        score:    a.averageScore ? +(a.averageScore / 10).toFixed(2) : null,
        synopsis: a.description ? a.description.replace(/<[^>]*>/g, '') : '',
        genres:   a.genres || [],
        author,
        year:     a.startDate?.year || null,
        status:   a.status,
      };
    });
}

// O GraphQL rejeita variável declarada e não usada, então cada modo declara
// só o que realmente aplica.
async function anilistManga({ search, genre, page = 1, perPage }) {
  const decls = ['$page: Int', '$perPage: Int'];
  const args  = [];
  const vars  = { page, perPage };

  if (search) {
    decls.push('$search: String');
    args.push('search: $search', 'sort: SEARCH_MATCH');
    vars.search = search;
  } else if (genre) {
    decls.push('$genre: String');
    args.push('genre: $genre', 'sort: SCORE_DESC');
    vars.genre = genre;
  } else {
    args.push('sort: POPULARITY_DESC');
  }

  const gql = `query (${decls.join(', ')}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(type: MANGA, ${args.join(', ')}) {
        ${ANILIST_MANGA_FIELDS}
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: vars }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message);
  const p = json.data?.Page;
  return { data: mapAnilistManga(p?.media || []), hasNext: p?.pageInfo?.hasNextPage ?? false };
}

app.get('/api/manga/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const { data } = await anilistManga({ search: q, perPage: 24 });
    res.json({ data });
  } catch (err) {
    console.warn('[manga search] falhou:', err.message);
    res.status(502).json({ error: 'busca indisponível' });
  }
});

const popularMangaCache = { data: null, expiresAt: 0 };

app.get('/api/manga/popular', async (req, res) => {
  if (popularMangaCache.data && popularMangaCache.expiresAt > Date.now()) {
    return res.json({ data: popularMangaCache.data });
  }
  try {
    const { data } = await anilistManga({ perPage: 18 });
    popularMangaCache.data = data;
    popularMangaCache.expiresAt = Date.now() + CACHE_TTL;
    res.json({ data });
  } catch (err) {
    console.warn('[manga popular] falhou:', err.message);
    res.status(502).json({ error: 'sugestões indisponíveis' });
  }
});

app.get('/api/manga/genre', async (req, res) => {
  const genre = String(req.query.genre || '').trim();
  const page  = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  if (!genre) return res.status(400).json({ error: 'genre required' });
  try {
    res.json(await anilistManga({ genre, page, perPage: 12 }));
  } catch (err) {
    console.warn('[manga genre] falhou:', err.message);
    res.status(502).json({ error: 'recomendações indisponíveis' });
  }
});

// Relações de um mangá: diferente do anime, aqui ADAPTATION é o item mais
// valioso (a adaptação em anime), e o nó pode ser de qualquer mídia — por isso
// o conjunto de campos cobre os dois e cada nó vai para o mapper certo.
const MANGA_RELATION_LABELS = {
  ADAPTATION:  'Adaptação',
  SEQUEL:      'Sequência',
  PREQUEL:     'Prequela',
  SIDE_STORY:  'História paralela',
  SPIN_OFF:    'Spin-off',
  ALTERNATIVE: 'Versão alternativa',
  PARENT:      'Obra principal',
  SUMMARY:     'Resumo',
};

const ANILIST_ANY_FIELDS = `idMal id type format title { romaji english } coverImage { large }
        episodes duration chapters volumes averageScore description(asHtml: false) genres status
        startDate { year } studios(isMain: true) { nodes { name } }
        staff(perPage: 4) { edges { role node { name { full } } } }`;

function mapAnyNode(node) {
  if (node.type === 'ANIME') {
    const mapped = mapAnilistMedia([node])[0];
    return mapped && { ...mapped, mediaType: 'ANIME' };
  }
  const mapped = mapAnilistManga([node])[0];
  return mapped && { ...mapped, mediaType: 'MANGA' };
}

const mangaRelatedCache = new Map();

async function anilistMangaRelated(idMal) {
  const gql = `query ($idMal: Int) {
    Media(idMal: $idMal, type: MANGA) {
      relations { edges { relationType node { ${ANILIST_ANY_FIELDS} } } }
      recommendations(sort: RATING_DESC, perPage: 10) {
        nodes { mediaRecommendation { ${ANILIST_ANY_FIELDS} } }
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { idMal } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message);

  const media = json.data?.Media;
  if (!media) return { franchise: [], similar: [] };

  const franchise = (media.relations?.edges || [])
    .filter(e => MANGA_RELATION_LABELS[e.relationType] && e.node?.idMal)
    .map(e => {
      const item = mapAnyNode(e.node);
      if (!item) return null;
      const label = e.relationType === 'ADAPTATION' && e.node.type === 'ANIME'
        ? 'Adaptação em anime'
        : MANGA_RELATION_LABELS[e.relationType];
      return { ...item, relationLabel: label };
    })
    .filter(Boolean);

  const similar = (media.recommendations?.nodes || [])
    .map(n => n.mediaRecommendation)
    .filter(n => n?.idMal)
    .map(mapAnyNode)
    .filter(Boolean);

  return { franchise, similar };
}

app.get('/api/manga/related/:malId', async (req, res) => {
  const malId = parseInt(req.params.malId, 10);
  if (!Number.isInteger(malId) || malId <= 0) return res.status(400).json({ error: 'malId inválido' });

  const hit = mangaRelatedCache.get(malId);
  if (hit && hit.expiresAt > Date.now()) return res.json(hit.data);

  try {
    const data = await anilistMangaRelated(malId);
    mangaRelatedCache.set(malId, { data, expiresAt: Date.now() + CACHE_TTL });
    res.json(data);
  } catch (err) {
    console.warn('[manga related] falhou:', err.message);
    res.status(502).json({ error: 'relacionados indisponíveis' });
  }
});

// ── Start ─────────────────────────────────────────────────────
initTurso()
  .then(() => app.listen(PORT, () => console.log(`AnimeDex rodando em http://localhost:${PORT}`)))
  .catch(err => { console.error('[initTurso]', err); process.exit(1); });
