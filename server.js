const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app      = express();
const PORT     = 3131;
const DB_FILE  = path.join(__dirname, 'data.json');

// ── DB helpers ────────────────────────────────────────────────
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeDB(list) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(__dirname));

// ── Jikan proxy com cache e retry ────────────────────────────
const JIKAN   = 'https://api.jikan.moe/v4';
const cache   = new Map();          // url → { data, expiresAt }
const CACHE_TTL = 5 * 60 * 1000;   // 5 minutos

async function jikanFetch(url, retries = 3, delayMs = 1500) {
  // Serve do cache se ainda válido
  const cached = cache.get(url);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(tid);

      if (res.status === 429) {
        // Rate-limit: espera mais antes de retry
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
      if (err.name === 'AbortError') {
        console.warn(`[jikan] timeout: ${url} (tentativa ${attempt + 1})`);
      } else {
        console.warn(`[jikan] erro: ${err.message} (tentativa ${attempt + 1})`);
      }
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
}

// ── AniList fallback ──────────────────────────────────────────

// Mapeamento Jikan genre ID → nome AniList
const JIKAN_GENRE_TO_ANILIST = {
  1:  'Action',
  2:  'Adventure',
  4:  'Comedy',
  8:  'Drama',
  10: 'Fantasy',
  14: 'Horror',
  7:  'Mystery',
  22: 'Romance',
  24: 'Sci-Fi',
  36: 'Slice of Life',
  30: 'Sports',
  37: 'Supernatural',
  41: 'Thriller',
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

async function anilistFetch(variables, extraFilter = '') {
  const gql = `query ($page: Int, $perPage: Int${extraFilter ? ', $genre: String, $search: String' : ', $search: String'}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(type: ANIME, sort: SCORE_DESC${extraFilter}
        ${Object.keys(variables).includes('search') ? ', search: $search' : ''}
      ) {
        idMal id
        title { romaji english }
        coverImage { large }
        episodes averageScore
        description(asHtml: false)
        genres duration status
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'AniList GraphQL error');
  return json.data?.Page;
}

async function anilistByGenre(genreId, page = 1) {
  const genreName = JIKAN_GENRE_TO_ANILIST[genreId];
  if (!genreName) throw new Error(`Gênero ${genreId} sem mapeamento AniList`);

  const gql = `query ($genre: String, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(type: ANIME, genre: $genre, sort: SCORE_DESC) {
        idMal id
        title { romaji english }
        coverImage { large }
        episodes averageScore
        description(asHtml: false)
        genres duration status
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { genre: genreName, page, perPage: 12 } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'AniList error');
  const pageData = json.data?.Page;
  return {
    data: mapAnilistMedia(pageData?.media || []),
    pagination: { has_next_page: pageData?.pageInfo?.hasNextPage ?? false },
  };
}

async function anilistSearch(query) {
  const gql = `query ($search: String, $perPage: Int) {
    Page(perPage: $perPage) {
      media(search: $search, type: ANIME, sort: SCORE_DESC) {
        idMal id
        title { romaji english }
        coverImage { large }
        episodes averageScore
        description(asHtml: false)
        genres duration status
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables: { search: query, perPage: 20 } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message || 'AniList error');
  return {
    data: mapAnilistMedia(json.data?.Page?.media || []),
    pagination: { has_next_page: false },
  };
}

// GET /api/jikan?path=/anime?q=...  — proxy genérico
app.get('/api/jikan', async (req, res) => {
  const jikanPath = req.query.path;
  if (!jikanPath) return res.status(400).json({ error: 'path required' });

  // Tenta Jikan primeiro
  try {
    const data = await jikanFetch(`${JIKAN}${jikanPath}`);
    return res.json(data);
  } catch (err) {
    console.warn('[jikan] falhou, tentando AniList…', err.message);
  }

  // Fallback AniList
  const urlObj    = new URL(jikanPath, 'http://x');
  const q         = urlObj.searchParams.get('q');
  const genreIds  = urlObj.searchParams.get('genres');
  const page      = parseInt(urlObj.searchParams.get('page') || '1', 10);

  // Busca por query
  if (q) {
    try {
      console.log('[anilist] fallback search:', q);
      return res.json(await anilistSearch(q));
    } catch (err2) {
      console.warn('[anilist] search falhou:', err2.message);
    }
  }

  // Busca por gênero (recomendações)
  if (genreIds) {
    const firstGenre = parseInt(genreIds.split(',')[0], 10);
    try {
      console.log('[anilist] fallback genre:', firstGenre, 'page:', page);
      return res.json(await anilistByGenre(firstGenre, page));
    } catch (err2) {
      console.warn('[anilist] genre falhou:', err2.message);
    }
  }

  res.status(502).json({ error: 'API indisponível no momento. Tente novamente em breve.' });
});

// ── API ───────────────────────────────────────────────────────

// GET all entries
app.get('/api/list', (req, res) => {
  res.json(readDB());
});

// POST upsert (add or update by malId)
app.post('/api/list', (req, res) => {
  const entry = req.body;
  if (!entry || !entry.malId) {
    return res.status(400).json({ error: 'malId required' });
  }

  const list = readDB();
  const idx  = list.findIndex(e => e.malId === entry.malId);

  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.unshift(entry);
  }

  writeDB(list);
  res.json({ ok: true, total: list.length });
});

// DELETE by malId
app.delete('/api/list/:malId', (req, res) => {
  const malId = +req.params.malId;
  if (!malId) return res.status(400).json({ error: 'invalid malId' });

  const list = readDB().filter(e => e.malId !== malId);
  writeDB(list);
  res.json({ ok: true, total: list.length });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`MyList rodando em http://localhost:${PORT}`);
});
