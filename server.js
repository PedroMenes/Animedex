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
        idMal id title { romaji english } coverImage { large }
        episodes averageScore description(asHtml: false) genres duration status
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
        idMal id title { romaji english } coverImage { large }
        episodes averageScore description(asHtml: false) genres duration status
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

// ── Start ─────────────────────────────────────────────────────
initTurso()
  .then(() => app.listen(PORT, () => console.log(`AnimeDex rodando em http://localhost:${PORT}`)))
  .catch(err => { console.error('[initTurso]', err); process.exit(1); });
