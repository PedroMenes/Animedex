// ── Storage ──────────────────────────────────────────────────
const STORAGE_KEY = 'myanimelist_data';
const API_BASE    = '/api';

// localStorage — cache rápido para renderização imediata
function cacheGet() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function cacheSet(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// API REST — banco de dados persistente no servidor
async function apiLoad() {
  const res = await fetch(`${API_BASE}/list`);
  if (!res.ok) throw new Error('falha ao carregar');
  return res.json();
}
async function apiSave(entry) {
  const res = await fetch(`${API_BASE}/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error('falha ao salvar');
}
async function apiDelete(malId) {
  const res = await fetch(`${API_BASE}/list/${malId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('falha ao deletar');
}

// Inicia com cache local para exibição imediata
let myList = cacheGet();

// ── Jikan via proxy local ─────────────────────────────────────
async function jikan(path) {
  const res = await fetch(`${API_BASE}/jikan?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Erro na API');
  }
  return res.json();
}

async function searchAnime(query) {
  const json = await jikan(`/anime?q=${encodeURIComponent(query)}&limit=20&sfw=true`);
  return json.data || [];
}

// ── Navigation ────────────────────────────────────────────────
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');

function showView(id) {
  views.forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${id}`).classList.add('active');
  navItems.forEach(n => {
    n.classList.toggle('active', n.dataset.view === id);
  });
  if (id === 'dashboard') renderDashboard();
  if (id === 'list') renderList();
  if (id === 'stats') renderStats();
  if (id === 'search' && !searchResults.children.length) showPopularSuggestions();
}

navItems.forEach(n => {
  n.addEventListener('click', e => { e.preventDefault(); showView(n.dataset.view); });
});

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-view]');
  if (btn && !btn.classList.contains('nav-item')) {
    e.preventDefault();
    showView(btn.dataset.view);
  }
});

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
  const counts = { watching: 0, completed: 0, plan_to_watch: 0, on_hold: 0, dropped: 0 };
  let scoreSum = 0, scoreCount = 0;

  myList.forEach(a => {
    if (counts[a.status] !== undefined) counts[a.status]++;
    if (a.userScore > 0) { scoreSum += a.userScore; scoreCount++; }
  });

  document.getElementById('count-watching').textContent  = counts.watching;
  document.getElementById('count-completed').textContent = counts.completed;
  document.getElementById('count-planned').textContent   = counts.plan_to_watch;
  document.getElementById('avg-score').textContent       = scoreCount ? (scoreSum / scoreCount).toFixed(1) : '—';
  document.getElementById('nav-total').textContent       = myList.length;
  document.getElementById('watching-count').textContent  = counts.watching;

  document.querySelectorAll('.tab-count').forEach(el => {
    const key = el.dataset.count;
    el.textContent = key === 'all' ? myList.length : counts[key];
  });
}

// ── Status metadata ───────────────────────────────────────────
const STATUS_META = {
  watching:      { label: 'Assistindo', color: 'var(--st-watching)' },
  completed:     { label: 'Completo',   color: 'var(--st-completed)' },
  plan_to_watch: { label: 'Planejado',  color: 'var(--st-planned)' },
  on_hold:       { label: 'Em Pausa',   color: 'var(--st-onhold)' },
  dropped:       { label: 'Dropado',    color: 'var(--st-dropped)' },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.plan_to_watch;
}

function statusPill(status) {
  const s = statusMeta(status);
  return `<span class="status-pill" style="--st-color:${s.color}">${s.label}</span>`;
}

// ── Genres — label (pt-BR) + color ───────────────────────────
const GENRE_INFO = {
  'action':        ['Ação',          '#E11D48'],
  'adventure':     ['Aventura',      '#EA8C00'],
  'comedy':        ['Comédia',       '#CA8A04'],
  'drama':         ['Drama',         '#BE123C'],
  'fantasy':       ['Fantasia',      '#8B5CF6'],
  'horror':        ['Terror',        '#7E22CE'],
  'mystery':       ['Mistério',      '#0D9488'],
  'romance':       ['Romance',       '#EC4899'],
  'sci-fi':        ['Sci-Fi',        '#0EA5E9'],
  'slice of life': ['Slice of Life', '#10B981'],
  'sports':        ['Esportes',      '#65A30D'],
  'supernatural':  ['Sobrenatural',  '#7C3AED'],
  'suspense':      ['Suspense',      '#475569'],
  'psychological': ['Psicológico',   '#6D28D9'],
  'historical':    ['Histórico',     '#A16207'],
  'military':      ['Militar',       '#4D7C0F'],
  'school':        ['Escolar',       '#0284C7'],
  'music':         ['Música',        '#9333EA'],
  'mecha':         ['Mecha',         '#334155'],
  'gourmet':       ['Gourmet',       '#EA580C'],
  'award winning': ['Premiado',      '#B45309'],
  'avant garde':   ['Vanguarda',     '#4B5563'],
  'ecchi':         ['Ecchi',         '#DB2777'],
  'boys love':     ['Boys Love',     '#F472B6'],
  'girls love':    ['Girls Love',    '#C026D3'],
  'erotica':       ['Erótico',       '#9D174D'],
};

function genreInfo(name) {
  const key = String(name).toLowerCase();
  const hit = GENRE_INFO[key];
  return hit ? { label: hit[0], color: hit[1] } : { label: name, color: '#5A6478' };
}

function genreTags(genres, limit = 2) {
  return (genres || []).slice(0, limit)
    .map(g => {
      const { label, color } = genreInfo(g);
      return `<span class="genre-tag" style="--tag-color:${color}">${label}</span>`;
    })
    .join('');
}

function cardSubtitle(entry) {
  return [entry.studio, entry.year].filter(Boolean).join(' · ');
}

// ── Overlay HTML helpers ──────────────────────────────────────
const STAR_SVG = '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

function buildOverlay(synopsis, notes) {
  const synopsisHTML = synopsis
    ? `<p class="card-overlay-synopsis">${synopsis.substring(0, 300)}</p>`
    : `<p class="card-overlay-no-synopsis">Sem sinopse disponível.</p>`;

  const notesHTML = notes
    ? `<div class="card-overlay-divider"></div>
       <span class="card-overlay-notes-label">Sua análise</span>
       <p class="card-overlay-notes">${notes.substring(0, 200)}</p>`
    : '';

  return `<div class="card-overlay">${synopsisHTML}${notesHTML}</div>`;
}

// ── Anime Card HTML ───────────────────────────────────────────
function animeCardHTML(entry) {
  const s = statusMeta(entry.status);
  const rating = entry.userScore > 0
    ? `<span class="rating-badge">${STAR_SVG}${entry.userScore}</span>`
    : '';

  const total   = entry.totalEpisodes || 0;
  const watched = entry.epWatched || 0;
  const pct     = total ? Math.min(100, (watched / total) * 100) : 0;
  const sub     = cardSubtitle(entry);

  return `
    <div class="anime-card" data-mal-id="${entry.malId}" style="--st-color:${s.color}">
      <div class="anime-card-cover-wrap">
        <span class="status-badge">${s.label}</span>
        ${rating}
        <img class="anime-card-cover" src="${entry.image}" alt="${entry.title}" loading="lazy" />
        ${buildOverlay(entry.synopsis, entry.notes)}
      </div>
      <div class="anime-card-body">
        <div class="anime-card-title">${entry.title}</div>
        ${sub ? `<div class="anime-card-sub">${sub}</div>` : ''}
        <div class="genre-tags">${genreTags(entry.genres)}</div>
        <div class="card-progress">
          <div class="card-progress-head">
            <span>Episódios</span>
            <strong>${watched}/${total || '?'}</strong>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
        </div>
      </div>
    </div>`;
}

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
  updateStats();

  const watchingRow = document.getElementById('watching-row');
  const recentRow   = document.getElementById('recent-row');

  const watching = myList.filter(a => a.status === 'watching');
  const recent   = [...myList].sort((a, b) => b.addedAt - a.addedAt).slice(0, 10);

  watchingRow.innerHTML = watching.length
    ? watching.map(animeCardHTML).join('')
    : '<div class="empty-row">Nenhum anime em andamento</div>';

  recentRow.innerHTML = recent.length
    ? recent.map(animeCardHTML).join('')
    : '<div class="empty-row">Nenhum anime adicionado</div>';

  watchingRow.querySelectorAll('.anime-card').forEach(c =>
    c.addEventListener('click', () => openModal(+c.dataset.malId)));
  recentRow.querySelectorAll('.anime-card').forEach(c =>
    c.addEventListener('click', () => openModal(+c.dataset.malId)));
}

// ── Search ────────────────────────────────────────────────────
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchSpinner = document.getElementById('search-spinner');

const searchHint = document.getElementById('search-hint');
let popularCache = null;

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) {
    showPopularSuggestions();
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 600);
});

async function runSearch(query) {
  searchSpinner.style.display = 'flex';
  searchHint.textContent = 'Resultados';
  searchResults.innerHTML = '';
  try {
    const results = await searchAnime(query);
    renderSearchResults(results);
  } catch {
    searchResults.innerHTML = '<div class="search-placeholder"><p>Erro ao buscar. Tente novamente.</p></div>';
    toast('Erro ao buscar animes', 'error');
  } finally {
    searchSpinner.style.display = 'none';
  }
}

async function showPopularSuggestions() {
  searchHint.textContent = 'Sugestões populares';
  if (popularCache) { renderSearchResults(popularCache); return; }

  searchResults.innerHTML = '<div class="reco-loading"><div class="spinner"></div> Carregando…</div>';
  try {
    const json = await jikan('/top/anime?limit=10&sfw=true');
    popularCache = json.data || [];
    renderSearchResults(popularCache);
  } catch {
    searchResults.innerHTML = `<div class="search-placeholder">
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <p>Pesquise por um anime acima</p></div>`;
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    searchResults.innerHTML = '<div class="search-placeholder"><p>Nenhum resultado encontrado</p></div>';
    return;
  }

  searchResults.innerHTML = results.map(a => {
    const inList   = myList.some(e => e.malId === a.mal_id);
    const image    = a.images?.jpg?.image_url || a.images?.jpg?.large_image_url || '';
    const studio   = a.studios?.[0]?.name;
    const year     = a.year || a.aired?.prop?.from?.year;
    const episodes = a.episodes ? `${a.episodes} eps` : 'eps N/A';
    const meta     = [studio, year, episodes].filter(Boolean).join(' · ');
    const score    = a.score
      ? `<span class="result-score">${STAR_SVG}${a.score}</span>`
      : '';
    const tags     = genreTags((a.genres || []).map(g => g.name));
    const btnText  = inList ? 'Na lista ✓' : '+ Adicionar';
    const btnClass = inList ? 'btn-add in-list' : 'btn-add';

    return `
      <div class="result-card" data-mal-id="${a.mal_id}">
        <img class="result-thumb" src="${image}" alt="${a.title}" loading="lazy" />
        <div class="result-info">
          <div class="result-card-title">${a.title}</div>
          <div class="result-card-meta"><span>${meta}</span>${score}</div>
          <div class="genre-tags">${tags}</div>
        </div>
        <button class="${btnClass}">${btnText}</button>
      </div>`;
  }).join('');

  searchResults.querySelectorAll('.result-card').forEach(card => {
    const malId  = +card.dataset.malId;
    const result = results.find(r => r.mal_id === malId);

    card.querySelector('.btn-add').addEventListener('click', e => {
      e.stopPropagation();
      const inList = myList.some(e => e.malId === malId);
      openModalFromSearch(result, inList);
    });

    card.addEventListener('click', () => {
      const inList = myList.some(e => e.malId === malId);
      openModalFromSearch(result, inList);
    });
  });
}

// ── List View ─────────────────────────────────────────────────
let currentFilter = 'all';
let currentSort   = 'date_desc';

document.querySelectorAll('.filter-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderList();
  });
});

document.getElementById('sort-select').addEventListener('change', e => {
  currentSort = e.target.value;
  renderList();
});

function renderList() {
  updateStats();
  const grid = document.getElementById('list-grid');

  let items = currentFilter === 'all'
    ? [...myList]
    : myList.filter(a => a.status === currentFilter);

  items.sort((a, b) => {
    if (currentSort === 'date_desc') return b.addedAt - a.addedAt;
    if (currentSort === 'date_asc')  return a.addedAt - b.addedAt;
    if (currentSort === 'score_desc') return (b.userScore || 0) - (a.userScore || 0);
    if (currentSort === 'score_asc')  return (a.userScore || 0) - (b.userScore || 0);
    if (currentSort === 'title_asc')  return a.title.localeCompare(b.title);
    return 0;
  });

  if (!items.length) {
    grid.innerHTML = `
      <div class="empty-list">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
        <p>${currentFilter === 'all' ? 'Sua lista está vazia' : 'Nenhum anime nesta categoria'}</p>
        ${currentFilter === 'all' ? '<a href="#" class="btn-add-first" data-view="search">Buscar animes</a>' : ''}
      </div>`;
    return;
  }

  grid.innerHTML = items.map(animeCardHTML).join('');
  grid.querySelectorAll('.anime-card').forEach(c =>
    c.addEventListener('click', () => openModal(+c.dataset.malId)));
}

// ── Modal ─────────────────────────────────────────────────────
const overlay     = document.getElementById('modal-overlay');
const modalClose  = document.getElementById('modal-close');
const modalForm   = document.getElementById('modal-form');
const scoreSlider = document.getElementById('form-user-score');
const scoreDisp   = document.getElementById('score-display');
const btnRemove   = document.getElementById('btn-remove');

function parseDuration(str) {
  if (!str) return 24;
  const m = str.match(/(\d+)\s*min/);
  return m ? +m[1] : 24;
}

function openModal(malId) {
  const entry = myList.find(e => e.malId === malId);
  if (!entry) return;
  populateModal({
    mal_id:   entry.malId,
    title:    entry.title,
    image:    entry.image,
    episodes: entry.totalEpisodes,
    score:    entry.malScore,
    synopsis: entry.synopsis,
    genres:   entry.genres || [],
    duration: entry.duration || 24,
    studio:   entry.studio || '',
    year:     entry.year || '',
  }, entry);
}

function openModalFromSearch(animeData, inList) {
  const malId = animeData.mal_id;
  const existing = myList.find(e => e.malId === malId);
  populateModal({
    mal_id:   malId,
    title:    animeData.title,
    image:    animeData.images?.jpg?.large_image_url || animeData.images?.jpg?.image_url || '',
    episodes: animeData.episodes,
    score:    animeData.score,
    synopsis: animeData.synopsis,
    genres:   (animeData.genres || []).map(g => g.name),
    duration: parseDuration(animeData.duration),
    studio:   animeData.studios?.[0]?.name || existing?.studio || '',
    year:     animeData.year || animeData.aired?.prop?.from?.year || existing?.year || '',
  }, existing || null);
}

function populateModal(data, entry) {
  document.getElementById('form-mal-id').value    = data.mal_id;
  document.getElementById('form-title').value     = data.title;
  document.getElementById('form-image').value     = data.image || '';
  document.getElementById('form-episodes').value  = data.episodes || 0;
  document.getElementById('form-score-mal').value = data.score || 0;
  document.getElementById('form-synopsis').value  = data.synopsis || '';
  document.getElementById('form-genres').value    = JSON.stringify(data.genres || []);
  document.getElementById('form-duration').value  = data.duration || 24;
  document.getElementById('form-studio').value    = data.studio || '';
  document.getElementById('form-year').value      = data.year || '';

  const epTotal = data.episodes ? `/ ${data.episodes}` : '/ ?';
  document.getElementById('ep-total').textContent = epTotal;

  const sub = [data.studio, data.year].filter(Boolean).join(' · ');
  const synopsis = (data.synopsis || '').replace(/\s*\[Written by MAL Rewrite\]\s*$/i, '').trim();
  const infoEl = document.getElementById('modal-anime-info');
  infoEl.innerHTML = `
    <div class="modal-anime-details">
      <h3>${data.title}</h3>
      ${sub ? `<div class="modal-anime-sub">${sub}</div>` : ''}
      ${data.score ? `<div class="mal-score">${STAR_SVG}${data.score} no MAL</div>` : ''}
      <div class="genre-tags">${genreTags(data.genres, 4)}</div>
      ${synopsis ? `<p class="modal-synopsis">${synopsis}</p>` : ''}
    </div>
    <img class="modal-cover" src="${data.image || ''}" alt="${data.title}" />`;

  const scores = entry?.scores || { story:0, animation:0, characters:0, soundtrack:0 };
  const epLog  = entry?.episodeLog || [];

  if (entry) {
    modalForm.querySelector(`input[name="status"][value="${entry.status}"]`).checked = true;
    scoreSlider.value = entry.userScore || 0;
    document.getElementById('form-ep-watched').value = entry.epWatched || 0;
    document.getElementById('form-notes').value = entry.notes || '';
    btnRemove.style.display = 'inline-flex';
  } else {
    modalForm.querySelector('input[name="status"][value="plan_to_watch"]').checked = true;
    scoreSlider.value = 0;
    document.getElementById('form-ep-watched').value = 0;
    document.getElementById('form-notes').value = '';
    btnRemove.style.display = 'none';
  }

  const cats = ['story','animation','characters','soundtrack'];
  cats.forEach(c => {
    document.getElementById(`score-${c}`).value = scores[c] || 0;
    document.getElementById(`val-${c}`).textContent = scores[c] > 0 ? scores[c] : '—';
  });

  const totalEps = data.episodes || 0;
  const trackerWrap = document.getElementById('ep-tracker-wrap');
  const epGrid = document.getElementById('ep-grid');
  if (totalEps > 0 && totalEps <= 100) {
    trackerWrap.style.display = 'block';
    const watchedSet = new Set(epLog.map(e => e.num));
    epGrid.innerHTML = Array.from({length: totalEps}, (_, i) => {
      const n = i + 1;
      return `<button type="button" class="ep-btn${watchedSet.has(n) ? ' watched' : ''}" data-ep="${n}">${n}</button>`;
    }).join('');
    epGrid.querySelectorAll('.ep-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('watched');
        const watched = epGrid.querySelectorAll('.ep-btn.watched').length;
        document.getElementById('form-ep-watched').value = watched;
      });
    });
  } else {
    trackerWrap.style.display = 'none';
    epGrid.innerHTML = '';
  }

  updateScoreDisplay();
  overlay.style.display = 'flex';
}

function updateScoreDisplay() {
  const v = +scoreSlider.value;
  scoreDisp.textContent = v === 0 ? '—' : v;
}

scoreSlider.addEventListener('input', updateScoreDisplay);

['story','animation','characters','soundtrack'].forEach(c => {
  document.getElementById(`score-${c}`).addEventListener('input', function() {
    const v = +this.value;
    document.getElementById(`val-${c}`).textContent = v > 0 ? v : '—';
    const vals = ['story','animation','characters','soundtrack']
      .map(x => +document.getElementById(`score-${x}`).value)
      .filter(x => x > 0);
    if (vals.length) {
      const avg = Math.round(vals.reduce((a,b) => a+b, 0) / vals.length);
      scoreSlider.value = avg;
      updateScoreDisplay();
    }
  });
});

modalClose.addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
function closeModal() { overlay.style.display = 'none'; }

// Save — apenas localStorage
modalForm.addEventListener('submit', e => {
  e.preventDefault();
  const malId    = +document.getElementById('form-mal-id').value;
  const title    = document.getElementById('form-title').value;
  const image    = document.getElementById('form-image').value;
  const episodes = +document.getElementById('form-episodes').value;
  const malScore = +document.getElementById('form-score-mal').value;
  const synopsis = document.getElementById('form-synopsis').value;
  const genres   = JSON.parse(document.getElementById('form-genres').value || '[]');
  const duration = +document.getElementById('form-duration').value || 24;
  const studio   = document.getElementById('form-studio').value;
  const year     = document.getElementById('form-year').value;
  const scores   = {
    story:      +document.getElementById('score-story').value,
    animation:  +document.getElementById('score-animation').value,
    characters: +document.getElementById('score-characters').value,
    soundtrack: +document.getElementById('score-soundtrack').value,
  };

  const prevEntry   = myList.find(e => e.malId === malId);
  const prevLog     = prevEntry?.episodeLog || [];
  const watchedBtns = document.querySelectorAll('#ep-grid .ep-btn.watched');
  const newWatchedNums = new Set([...watchedBtns].map(b => +b.dataset.ep));
  const episodeLog = [
    ...prevLog.filter(e => newWatchedNums.has(e.num)),
    ...[...newWatchedNums]
      .filter(n => !prevLog.some(e => e.num === n))
      .map(n => ({ num: n, watchedAt: Date.now() })),
  ].sort((a,b) => a.num - b.num);

  const status   = modalForm.querySelector('input[name="status"]:checked')?.value || 'plan_to_watch';
  const userScore= +scoreSlider.value;
  const epWatched= +document.getElementById('form-ep-watched').value;
  const notes    = document.getElementById('form-notes').value.trim();

  const idx = myList.findIndex(e => e.malId === malId);
  const entry = {
    malId, title, image, synopsis, genres, duration, studio, year,
    totalEpisodes: episodes,
    malScore,
    status, userScore, epWatched, notes,
    scores, episodeLog,
    addedAt: idx >= 0 ? myList[idx].addedAt : Date.now(),
    updatedAt: Date.now(),
  };

  const isUpdate = idx >= 0;
  if (isUpdate) {
    myList[idx] = entry;
  } else {
    myList.unshift(entry);
  }

  cacheSet(myList);
  closeModal();
  apiSave(entry)
    .then(() => toast(isUpdate ? 'Lista atualizada!' : 'Anime adicionado!', 'success'))
    .catch(() => toast('Salvo localmente — erro no banco', 'error'));
  updateStats();
  refreshSearchButtons();

  const activeView = document.querySelector('.view.active')?.id;
  if (activeView === 'view-dashboard') renderDashboard();
  if (activeView === 'view-list') renderList();
});

// Remove
btnRemove.addEventListener('click', () => {
  const malId = +document.getElementById('form-mal-id').value;
  myList = myList.filter(e => e.malId !== malId);
  cacheSet(myList);
  closeModal();
  updateStats();
  refreshSearchButtons();
  apiDelete(malId)
    .then(() => toast('Anime removido', ''))
    .catch(() => toast('Removido localmente — erro no banco', 'error'));

  const activeView = document.querySelector('.view.active')?.id;
  if (activeView === 'view-dashboard') renderDashboard();
  if (activeView === 'view-list') renderList();
});

function refreshSearchButtons() {
  document.querySelectorAll('.result-card').forEach(card => {
    const malId  = +card.dataset.malId;
    const inList = myList.some(e => e.malId === malId);
    const btn    = card.querySelector('.btn-add');
    if (btn) {
      btn.textContent = inList ? 'Na lista ✓' : '+ Adicionar';
      btn.className   = inList ? 'btn-add in-list' : 'btn-add';
    }
  });
}

// ── Recommendations ───────────────────────────────────────────
const GENRES = [
  { id: 1,  name: 'Ação',         color: GENRE_INFO['action'][1] },
  { id: 2,  name: 'Aventura',     color: GENRE_INFO['adventure'][1] },
  { id: 4,  name: 'Comédia',      color: GENRE_INFO['comedy'][1] },
  { id: 8,  name: 'Drama',        color: GENRE_INFO['drama'][1] },
  { id: 10, name: 'Fantasia',     color: GENRE_INFO['fantasy'][1] },
  { id: 14, name: 'Terror',       color: GENRE_INFO['horror'][1] },
  { id: 7,  name: 'Mistério',     color: GENRE_INFO['mystery'][1] },
  { id: 22, name: 'Romance',      color: GENRE_INFO['romance'][1] },
  { id: 24, name: 'Sci-Fi',       color: GENRE_INFO['sci-fi'][1] },
  { id: 36, name: 'Slice of Life',color: GENRE_INFO['slice of life'][1] },
  { id: 30, name: 'Esportes',     color: GENRE_INFO['sports'][1] },
  { id: 37, name: 'Sobrenatural', color: GENRE_INFO['supernatural'][1] },
  { id: 41, name: 'Suspense',     color: GENRE_INFO['suspense'][1] },
];

let activeGenreId    = null;
let activeGenreColor = null;
let recoPage         = 1;
let recoShownIds     = new Set();

function initGenrePills() {
  const container = document.getElementById('genre-pills');
  container.innerHTML = GENRES.map(g => `
    <button class="genre-pill" data-genre-id="${g.id}" style="--pill-color:${g.color}">
      ${g.name}
    </button>`).join('');

  container.querySelectorAll('.genre-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = +btn.dataset.genreId;
      if (activeGenreId === id) return;
      container.querySelectorAll('.genre-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeGenreId    = id;
      activeGenreColor = GENRES.find(g => g.id === id).color;
      recoPage         = 1;
      recoShownIds     = new Set();
      fetchRecommendations(false);
    });
  });
}

async function fetchRecommendations(append = false) {
  const area = document.getElementById('reco-area');

  if (!append) {
    area.innerHTML = `<div class="reco-loading"><div class="spinner"></div> Carregando…</div>`;
  } else {
    const btn = document.getElementById('btn-reco-more');
    if (btn) { btn.disabled = true; btn.textContent = 'Carregando…'; }
  }

  try {
    const json = await jikan(`/anime?genres=${activeGenreId}&order_by=score&sort=desc&limit=12&page=${recoPage}&sfw=true`);
    const hasNext = json.pagination?.has_next_page ?? false;
    appendRecommendations(json.data || [], hasNext, append);
  } catch {
    if (!append) {
      area.innerHTML = `<div class="reco-placeholder"><p>Erro ao carregar. Tente novamente.</p></div>`;
    } else {
      const btn = document.getElementById('btn-reco-more');
      if (btn) { btn.disabled = false; btn.textContent = 'Carregar mais'; }
    }
    toast('Erro ao buscar recomendações', 'error');
  }
}

function recoCardHTML(a, color) {
  const image  = a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || '';
  const studio = a.studios?.[0]?.name;
  const year   = a.year || a.aired?.prop?.from?.year;
  const sub    = [studio, year].filter(Boolean).join(' · ');
  const rating = a.score ? `<span class="rating-badge">${STAR_SVG}${a.score}</span>` : '';
  const inList = myList.some(e => e.malId === a.mal_id);
  return `
    <div class="reco-card" data-mal-id="${a.mal_id}" style="--pill-color:${color}">
      <div class="reco-card-cover-wrap">
        ${rating}
        <img class="reco-card-cover" src="${image}" alt="${a.title}" loading="lazy" />
        ${buildOverlay(a.synopsis, null)}
      </div>
      <div class="reco-card-body">
        <div class="reco-card-title">${a.title}</div>
        ${sub ? `<div class="reco-card-sub">${sub}</div>` : ''}
        <div class="genre-tags">${genreTags((a.genres || []).map(g => g.name))}</div>
      </div>
      <div class="reco-card-footer">
        <button class="btn-reco-add${inList ? ' in-list' : ''}">${inList ? 'Na lista ✓' : '+ Adicionar'}</button>
      </div>
    </div>`;
}

function appendRecommendations(results, hasNext, append) {
  const area = document.getElementById('reco-area');

  const newItems = results.filter(a =>
    !myList.some(e => e.malId === a.mal_id) && !recoShownIds.has(a.mal_id)
  );
  newItems.forEach(a => recoShownIds.add(a.mal_id));

  let grid;
  if (append) {
    grid = area.querySelector('.reco-grid');
    document.getElementById('btn-reco-more')?.parentElement?.remove();
  } else {
    if (!newItems.length) {
      area.innerHTML = `<div class="reco-grid"><div class="reco-empty"><p>Você já tem todos na lista!</p></div></div>`;
      return;
    }
    area.innerHTML = '<div class="reco-grid"></div>';
    grid = area.querySelector('.reco-grid');
  }

  newItems.forEach(a => {
    const tmp = document.createElement('div');
    tmp.innerHTML = recoCardHTML(a, activeGenreColor).trim();
    const card = tmp.firstElementChild;

    card.querySelector('.btn-reco-add').addEventListener('click', e => {
      e.stopPropagation();
      openModalFromSearch(a, myList.some(e => e.malId === a.mal_id));
    });
    card.addEventListener('click', () => {
      openModalFromSearch(a, myList.some(e => e.malId === a.mal_id));
    });

    grid.appendChild(card);
  });

  if (hasNext) {
    const wrap = document.createElement('div');
    wrap.className = 'reco-more-wrap';
    wrap.innerHTML = `<button id="btn-reco-more" class="btn-reco-more">Carregar mais</button>`;
    wrap.querySelector('#btn-reco-more').addEventListener('click', () => {
      recoPage++;
      fetchRecommendations(true);
    });
    area.appendChild(wrap);
  }
}

const _origRefresh = refreshSearchButtons;
refreshSearchButtons = function() {
  _origRefresh();
  document.querySelectorAll('.reco-card').forEach(card => {
    const malId  = +card.dataset.malId;
    const inList = myList.some(e => e.malId === malId);
    const btn    = card.querySelector('.btn-reco-add');
    if (btn) {
      btn.textContent = inList ? 'Na lista ✓' : '+ Adicionar';
      btn.className   = inList ? 'btn-reco-add in-list' : 'btn-reco-add';
    }
  });
};

// ── Stats ─────────────────────────────────────────────────────
function renderStats() {
  const totalEps   = myList.reduce((s, e) => s + (e.epWatched || 0), 0);
  const totalMins  = myList.reduce((s, e) => s + (e.epWatched || 0) * (e.duration || 24), 0);
  const totalHours = (totalMins / 60).toFixed(1);
  const scored     = myList.filter(e => e.userScore > 0);
  const avg        = scored.length ? (scored.reduce((s,e) => s + e.userScore, 0) / scored.length).toFixed(1) : '—';

  document.getElementById('stat-hours').textContent  = totalHours;
  document.getElementById('stat-eps').textContent    = totalEps;
  document.getElementById('stat-total').textContent  = myList.length;
  document.getElementById('stat-avg').textContent    = avg;

  const statusCounts = {
    'Assistindo': myList.filter(e=>e.status==='watching').length,
    'Completo':   myList.filter(e=>e.status==='completed').length,
    'Planejado':  myList.filter(e=>e.status==='plan_to_watch').length,
    'Em Pausa':   myList.filter(e=>e.status==='on_hold').length,
    'Dropado':    myList.filter(e=>e.status==='dropped').length,
  };
  const statusColors = ['var(--st-watching)','var(--st-completed)','var(--st-planned)','var(--st-onhold)','var(--st-dropped)'];
  const statusMax = Math.max(...Object.values(statusCounts), 1);
  document.getElementById('chart-status').innerHTML = Object.entries(statusCounts).map(([label, count], i) => `
    <div class="h-bar-row" style="--bar-color:${statusColors[i]}">
      <div class="h-bar-head">
        <span class="h-bar-label">${label}</span>
        <span class="h-bar-val">${count}</span>
      </div>
      <div class="h-bar-track"><div class="h-bar-fill" style="width:${(count/statusMax*100).toFixed(1)}%"></div></div>
    </div>`).join('');

  const genreMap = {};
  myList.forEach(e => (e.genres || []).forEach(g => { genreMap[g] = (genreMap[g]||0)+1; }));
  const topGenres = Object.entries(genreMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const genreMax = topGenres[0]?.[1] || 1;
  document.getElementById('chart-genres').innerHTML = topGenres.length
    ? topGenres.map(([g, c]) => {
        const { label, color } = genreInfo(g);
        return `
        <div class="h-bar-row" style="--bar-color:${color}">
          <div class="h-bar-head">
            <span class="h-bar-label">${label}</span>
            <span class="h-bar-val">${c} ${c === 1 ? 'anime' : 'animes'}</span>
          </div>
          <div class="h-bar-track"><div class="h-bar-fill" style="width:${(c/genreMax*100).toFixed(1)}%"></div></div>
        </div>`;
      }).join('')
    : '<div class="empty-chart">Adicione animes para ver gêneros</div>';

  const scoreBuckets = Array.from({length:10}, (_,i) => myList.filter(e=>e.userScore===i+1).length);
  const scoreMax = Math.max(...scoreBuckets, 1);
  document.getElementById('chart-scores').innerHTML = `<div class="score-hist">${
    scoreBuckets.map((c,i) => `
      <div class="score-hist-col">
        <div class="score-hist-bar" style="height:${Math.max(4,(c/scoreMax*68)).toFixed(1)}px" title="${c} animes"></div>
        <span class="score-hist-num">${i+1}</span>
      </div>`).join('')
  }</div>`;

  const now = new Date();
  const months = Array.from({length:6}, (_,i) => {
    const d = new Date(now.getFullYear(), now.getMonth()-5+i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: d.toLocaleDateString('pt-BR',{month:'short'}) };
  });
  const monthCounts = {};
  months.forEach(m => { monthCounts[m.key] = 0; });
  myList.forEach(e => (e.episodeLog||[]).forEach(ep => {
    const k = new Date(ep.watchedAt).toISOString().slice(0,7);
    if (monthCounts[k] !== undefined) monthCounts[k]++;
  }));
  const monthMax = Math.max(...Object.values(monthCounts), 1);
  document.getElementById('chart-monthly').innerHTML = months.map(m => `
    <div class="month-col">
      <span class="month-val">${monthCounts[m.key]||''}</span>
      <div class="month-bar" style="height:${Math.max(2,(monthCounts[m.key]/monthMax*80)).toFixed(1)}px"></div>
      <span class="month-label">${m.label}</span>
    </div>`).join('');

  const top5 = [...myList].filter(e=>e.userScore>0).sort((a,b)=>b.userScore-a.userScore).slice(0,5);
  document.getElementById('chart-top5').innerHTML = top5.length
    ? top5.map((e,i) => {
        const sub = cardSubtitle(e);
        return `
          <div class="top5-item" data-mal-id="${e.malId}">
            <span class="top5-rank">${i+1}</span>
            <img class="top5-img" src="${e.image}" alt="${e.title}" loading="lazy"/>
            <div class="top5-info">
              <div class="top5-title">${e.title}</div>
              <div class="top5-meta">
                ${statusPill(e.status)}
                ${sub ? `<span class="result-card-meta">${sub}</span>` : ''}
              </div>
            </div>
            <span class="top5-score">${e.userScore}<small>/10</small></span>
          </div>`;
      }).join('')
    : '<div class="empty-chart">Avalie seus animes para ver o top</div>';

  document.querySelectorAll('.top5-item').forEach(el =>
    el.addEventListener('click', () => openModal(+el.dataset.malId)));
}

// ── Season Calendar ────────────────────────────────────────────
const DAY_ORDER = ['Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays','Sundays'];
const DAY_PT    = { Mondays:'Segunda',Tuesdays:'Terça',Wednesdays:'Quarta',Thursdays:'Quinta',Fridays:'Sexta',Saturdays:'Sábado',Sundays:'Domingo' };

async function loadSeasonCalendar() {
  const loading = document.getElementById('season-loading');
  const daysEl  = document.getElementById('season-days');
  try {
    const json = await jikan(`/seasons/now?limit=25`);
    const list = json.data || [];

    const grouped = {};
    DAY_ORDER.forEach(d => { grouped[d] = []; });
    list.forEach(a => {
      const day = a.broadcast?.day;
      if (day && grouped[day]) grouped[day].push(a);
    });

    loading.style.display = 'none';
    daysEl.style.display  = 'flex';
    daysEl.innerHTML = DAY_ORDER
      .filter(d => grouped[d].length)
      .map(d => `
        <div class="season-day-group">
          <div class="season-day-label">${DAY_PT[d] || d}</div>
          <div class="season-row">${grouped[d].map(a => {
            const img     = a.images?.jpg?.image_url || '';
            const score   = a.score ? `<span class="season-card-score">${STAR_SVG}${a.score}</span>` : '';
            const inList  = myList.some(e => e.malId === a.mal_id);
            return `
              <div class="season-card" data-mal-id="${a.mal_id}" data-raw='${JSON.stringify({mal_id:a.mal_id,title:a.title,images:a.images,episodes:a.episodes,score:a.score,synopsis:a.synopsis,genres:a.genres,duration:a.duration,studios:a.studios,year:a.year,aired:a.aired}).replace(/'/g,"&#39;")}'>
                <img class="season-card-img" src="${img}" alt="${a.title}" loading="lazy"/>
                ${inList ? '<span class="season-in-list">Na lista</span>' : ''}
                <div class="season-card-body">
                  <div class="season-card-title">${a.title}</div>
                  ${score}
                </div>
              </div>`;
          }).join('')}</div>
        </div>`).join('');

    daysEl.querySelectorAll('.season-card').forEach(card => {
      card.addEventListener('click', () => {
        const raw = JSON.parse(card.dataset.raw.replace(/&#39;/g,"'"));
        openModalFromSearch(raw, myList.some(e => e.malId === raw.mal_id));
      });
    });
  } catch {
    loading.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">Erro ao carregar temporada</span>';
  }
}

// ── Auth ──────────────────────────────────────────────────────
const authScreen  = document.getElementById('auth-screen');
const formLogin   = document.getElementById('form-login');
const formReg     = document.getElementById('form-register');
const tabLogin    = document.getElementById('tab-login');
const tabReg      = document.getElementById('tab-register');
const loginErr    = document.getElementById('login-error');
const regErr      = document.getElementById('reg-error');

function showAuthScreen() {
  authScreen.style.display = 'flex';
  document.getElementById('login-username').focus();
}

function hideAuthScreen(username) {
  authScreen.style.display = 'none';
  document.getElementById('nav-avatar').textContent   = username.charAt(0).toUpperCase();
  document.getElementById('nav-username').textContent = username;
}

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabReg.classList.remove('active');
  formLogin.style.display = '';
  formReg.style.display   = 'none';
  loginErr.textContent    = '';
});

tabReg.addEventListener('click', () => {
  tabReg.classList.add('active');
  tabLogin.classList.remove('active');
  formReg.style.display   = '';
  formLogin.style.display = 'none';
  regErr.textContent      = '';
});

formLogin.addEventListener('submit', async e => {
  e.preventDefault();
  loginErr.textContent = '';
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = formLogin.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { loginErr.textContent = data.error; return; }
    hideAuthScreen(data.username);
    await loadUserData();
  } catch {
    loginErr.textContent = 'Erro de conexão. Verifique o servidor.';
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

formReg.addEventListener('submit', async e => {
  e.preventDefault();
  regErr.textContent = '';
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-confirm').value;
  if (password !== confirm) { regErr.textContent = 'As senhas não coincidem'; return; }
  const btn = formReg.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Criando…';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { regErr.textContent = data.error; return; }
    hideAuthScreen(data.username);
    await loadUserData();
  } catch {
    regErr.textContent = 'Erro de conexão. Verifique o servidor.';
  } finally {
    btn.disabled = false; btn.textContent = 'Criar conta';
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  myList = [];
  cacheSet([]);
  updateStats();
  renderDashboard();
  showAuthScreen();
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
});

// ── Init ──────────────────────────────────────────────────────
async function loadUserData() {
  try {
    const dbList = await apiLoad();
    if (dbList.length === 0 && myList.length > 0) {
      for (const entry of myList) await apiSave(entry);
      toast('Lista migrada para sua conta!', 'success');
    } else {
      myList = dbList;
      cacheSet(myList);
    }
  } catch {
    // Servidor indisponível — usa cache local
  }
  renderDashboard();
  initGenrePills();
  loadSeasonCalendar();
}

async function init() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { showAuthScreen(); return; }
    const { username } = await res.json();
    hideAuthScreen(username);
    await loadUserData();
  } catch {
    showAuthScreen();
  }
}

init();
