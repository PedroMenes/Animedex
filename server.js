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

// ── Jikan proxy (evita timeout e rate-limit no browser) ───────
const JIKAN = 'https://api.jikan.moe/v4';

async function jikanFetch(url, retries = 3, delayMs = 1200) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.status === 429 || res.status >= 500) {
        if (i < retries - 1) { await new Promise(r => setTimeout(r, delayMs * (i + 1))); continue; }
        throw new Error(`Jikan ${res.status}`);
      }
      return res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

// GET /api/search?q=...
app.get('/api/search', async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.status(400).json({ error: 'query required' });
  try {
    const data = await jikanFetch(`${JIKAN}/anime?q=${encodeURIComponent(q)}&limit=20&sfw=true`);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Jikan indisponível. Tente novamente.' });
  }
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
