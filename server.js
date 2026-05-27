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
