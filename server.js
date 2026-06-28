const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const session  = require('express-session');
const crypto   = require('crypto');

const app        = express();
const PORT       = process.env.PORT || 3131;
const DB_FILE    = path.join(__dirname, 'data.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const SECRET_FILE= path.join(__dirname, '.session-secret');

// ── Session secret (env var em produção, arquivo em dev) ──────
function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, s, 'utf8');
  return s;
}

// ── DB helpers (por usuário) ──────────────────────────────────
function readDB() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // Migra formato legado (array global) para { userId: [] }
    if (Array.isArray(raw)) return { _legacy: raw };
    return raw;
  } catch {
    return {};
  }
}

function writeDB(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function readUserList(userId) {
  return readDB()[userId] || [];
}

function writeUserList(userId, list) {
  const db = readDB();
  db[userId] = list;
  writeDB(db);
}

// ── Users helpers ─────────────────────────────────────────────
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}

function writeUsers(users) {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(tmp, USERS_FILE);
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

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Não autenticado' });
  res.json({ userId: req.session.userId, username: req.session.username });
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Username e senha obrigatórios' });
  }
  if (username.trim().length < 3) {
    return res.status(400).json({ error: 'Username deve ter ao menos 3 caracteres' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Senha deve ter ao menos 4 caracteres' });
  }

  const users = readUsers();
  if (users.find(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
    return res.status(409).json({ error: 'Username já em uso' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = crypto.randomUUID();
  users.push({ id, username: username.trim(), passwordHash, createdAt: Date.now() });
  writeUsers(users);

  req.session.userId   = id;
  req.session.username = username.trim();
  res.json({ ok: true, username: username.trim() });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Preencha usuário e senha' });
  }

  const users = readUsers();
  const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Usuário ou senha incorretos' });

  req.session.userId   = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

// POST /api/auth/logout
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
  if (!genreName) throw new Error(`Gênero ${genreId} sem mapeamento AniList`);
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
  const pageData = json.data?.Page;
  return { data: mapAnilistMedia(pageData?.media || []), pagination: { has_next_page: pageData?.pageInfo?.hasNextPage ?? false } };
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

// GET /api/jikan?path=...
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

// ── List API (protegida por auth) ─────────────────────────────

app.get('/api/list', requireAuth, (req, res) => {
  res.json(readUserList(req.session.userId));
});

app.post('/api/list', requireAuth, (req, res) => {
  const entry = req.body;
  if (!entry?.malId) return res.status(400).json({ error: 'malId required' });

  const list = readUserList(req.session.userId);
  const idx  = list.findIndex(e => e.malId === entry.malId);
  if (idx >= 0) list[idx] = entry; else list.unshift(entry);
  writeUserList(req.session.userId, list);
  res.json({ ok: true, total: list.length });
});

app.delete('/api/list/:malId', requireAuth, (req, res) => {
  const malId = +req.params.malId;
  if (!malId) return res.status(400).json({ error: 'invalid malId' });

  const list = readUserList(req.session.userId).filter(e => e.malId !== malId);
  writeUserList(req.session.userId, list);
  res.json({ ok: true, total: list.length });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`AnimeDex rodando em http://localhost:${PORT}`);
});
