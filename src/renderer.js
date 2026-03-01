/* ─────────────────────────────────────────────────────────────────────────
   renderer.js  –  all UI logic for Contortion Gallery
   Depends on parser.js (parseDatabaseFile) loaded before this script.
───────────────────────────────────────────────────────────────────────── */
'use strict';

// ── Platform ──────────────────────────────────────────────────────────────
const SHOW_IN_FOLDER_LABEL = window.api.platform === 'darwin'
  ? 'Show in Finder'
  : window.api.platform === 'win32'
    ? 'Show in Explorer'
    : 'Show in Folder';

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  volumes: { 1: null, 2: null },  // { root, dbPath, photos[] }
  allPhotos: [],
  filteredPhotos: [],

  filters: {
    volumes:     new Set(),      // empty = all
    gender:      'all',
    categories:  new Set(),      // empty = all
    performers:  new Set(),      // empty = all
    search:      ''
  },

  sort:      'performer',
  thumbSize: 180,

  lightbox: {
    open:  false,
    index: 0          // index into filteredPhotos
  }
};

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const el = {
  welcome:       $('welcome-screen'),
  loading:       $('loading-screen'),
  loadingText:   $('loading-text'),
  noResults:     $('no-results'),
  grid:          $('gallery-grid'),
  filterSection: $('filter-section'),
  statsText:     $('stats-text'),

  btnVol1:  $('btn-select-vol1'),
  btnVol2:  $('btn-select-vol2'),
  vol1Path: $('vol1-path'),
  vol2Path: $('vol2-path'),
  vol1Card: $('vol1-card'),
  vol2Card: $('vol2-card'),

  globalSearch:   $('global-search'),
  sortSelect:     $('sort-select'),
  thumbSizeInput: $('thumb-size'),
  btnClearFilters: $('btn-clear-filters'),

  filterVolume:       $('filter-volume'),
  filterGender:       $('filter-gender'),
  filterCategoryList: $('filter-category-list'),
  filterPerformerList:$('filter-performer-list'),
  categorySearch:     $('category-search'),
  performerSearch:    $('performer-search'),

  lightbox:   $('lightbox'),
  lbBackdrop: $('lb-backdrop'),
  lbImage:    $('lb-image'),
  lbSpinner:  $('lb-spinner'),
  lbClose:    $('lb-close'),
  lbPrev:     $('lb-prev'),
  lbNext:     $('lb-next'),
  lbFilename: $('lb-filename'),
  lbDetails:  $('lb-details'),
  lbCounter:  $('lb-counter')
};

// ── Lazy-load observer ────────────────────────────────────────────────────
const imgObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      const img = entry.target;
      const src = img.dataset.src;
      if (src) {
        img.src = src;
        img.removeAttribute('data-src');
        imgObserver.unobserve(img);
      }
    }
  }
}, { rootMargin: '200px' });

// ── Volume loading ────────────────────────────────────────────────────────
async function selectVolume(volNum) {
  const folder = await window.api.selectFolder(`Select Volume ${volNum} Folder`);
  if (!folder) return;

  showLoading(`Loading Volume ${volNum}…`);

  try {
    const dbPath = await window.api.findDatabaseFile(folder, volNum);
    if (!dbPath) {
      hideLoading();
      alert(
        `Could not find database-roncd${volNum}-strings.txt in the selected folder.\n\n` +
        `Please make sure you selected the correct Volume ${volNum} folder.`
      );
      return;
    }

    const content = await window.api.readTextFile(dbPath);
    if (!content) {
      hideLoading();
      alert('Failed to read the database file.');
      return;
    }

    const rawPhotos = parseDatabaseFile(content, volNum);

    // Resolve local paths for each photo
    el.loadingText.textContent = `Resolving ${rawPhotos.length} photo paths…`;
    const photos = await resolvePhotoPaths(rawPhotos, folder);

    state.volumes[volNum] = { root: folder, dbPath, photos };

    // Update sidebar
    const pathEl = el[`vol${volNum}Path`];
    const cardEl = el[`vol${volNum}Card`];
    pathEl.textContent = shortenPath(folder);
    pathEl.classList.add('loaded');
    cardEl.classList.add('loaded');

    rebuildAllPhotos();
    applyFiltersAndRender();
  } catch (err) {
    console.error(err);
    alert('An error occurred while loading the volume: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function resolvePhotoPaths(photos, volumeRoot) {
  // Process in batches to keep UI responsive
  const BATCH = 50;
  for (let i = 0; i < photos.length; i += BATCH) {
    const batch = photos.slice(i, i + BATCH);
    await Promise.all(batch.map(async (photo) => {
      const localPath = await window.api.resolvePhotoPath(
        volumeRoot, photo.subfolder, photo.filename
      );
      if (localPath) {
        photo.localPath = localPath;
        photo.galleryUrl = await window.api.toGalleryUrl(localPath);
      }
    }));
    if (i % 200 === 0) {
      el.loadingText.textContent =
        `Resolving paths… ${Math.min(i + BATCH, photos.length)} / ${photos.length}`;
      // Yield to browser
      await new Promise(r => setTimeout(r, 0));
    }
  }
  return photos;
}

function rebuildAllPhotos() {
  state.allPhotos = [];
  for (const v of [1, 2]) {
    if (state.volumes[v]) {
      state.allPhotos.push(...state.volumes[v].photos);
    }
  }
}

// ── Filtering & sorting ───────────────────────────────────────────────────
function applyFiltersAndRender() {
  const { filters, sort } = state;
  const search = filters.search.toLowerCase().trim();

  let photos = state.allPhotos.filter(p => {
    // Volume
    if (filters.volumes.size > 0 && !filters.volumes.has(String(p.volume))) return false;
    // Gender
    if (filters.gender !== 'all' && p.gender !== filters.gender) return false;
    // Category
    if (filters.categories.size > 0) {
      const hit = p.categories.some(c => filters.categories.has(c));
      if (!hit) return false;
    }
    // Performer
    if (filters.performers.size > 0 && !filters.performers.has(p.performer)) return false;
    // Search
    if (search) {
      const haystack = [p.performer, p.gender, ...p.categories, p.filename]
        .join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // Sort
  photos = [...photos].sort((a, b) => {
    if (sort === 'performer') return a.performer.localeCompare(b.performer);
    if (sort === 'category')  return (a.categories[0] || '').localeCompare(b.categories[0] || '');
    if (sort === 'filename')  return a.filename.localeCompare(b.filename);
    if (sort === 'volume')    return a.volume - b.volume;
    return 0;
  });

  state.filteredPhotos = photos;
  renderGrid();
  updateStats();
  updateFilterSection();
}

// ── Grid rendering ────────────────────────────────────────────────────────
function renderGrid() {
  const photos = state.filteredPhotos;

  if (state.allPhotos.length === 0) {
    show(el.welcome);
    hide(el.grid);
    hide(el.noResults);
    return;
  }

  if (photos.length === 0) {
    hide(el.welcome);
    hide(el.grid);
    show(el.noResults);
    return;
  }

  hide(el.welcome);
  hide(el.noResults);
  show(el.grid);

  // Disconnect previous observers
  imgObserver.disconnect();

  // Build fragment
  const frag = document.createDocumentFragment();
  photos.forEach((photo, idx) => {
    frag.appendChild(createPhotoCard(photo, idx));
  });

  el.grid.innerHTML = '';
  el.grid.appendChild(frag);

  // Observe images only after they're in the DOM so IntersectionObserver
  // can correctly determine their visibility and trigger src assignment.
  el.grid.querySelectorAll('img[data-src]').forEach(img => imgObserver.observe(img));
}

function createPhotoCard(photo, idx) {
  const card = document.createElement('div');
  card.className = 'photo-card fade-in';
  card.tabIndex = 0;
  card.dataset.idx = idx;

  // Thumb
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'thumb-wrap';

  if (photo.galleryUrl) {
    const img = document.createElement('img');
    img.className = 'thumb-img';
    img.alt = photo.performer || photo.filename;
    img.dataset.src = photo.galleryUrl;
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', () => {
      img.remove();
      thumbWrap.appendChild(makeErrorPlaceholder());
    });
    thumbWrap.appendChild(img);
  } else {
    thumbWrap.appendChild(makeErrorPlaceholder('Not found'));
  }

  // Volume badge
  const badge = document.createElement('div');
  badge.className = 'volume-badge';
  badge.textContent = `V${photo.volume}`;
  thumbWrap.appendChild(badge);

  // Show in Finder / Explorer button
  if (photo.localPath) {
    const showBtn = document.createElement('button');
    showBtn.className = 'show-in-folder-btn';
    showBtn.title = SHOW_IN_FOLDER_LABEL;
    showBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="11" height="11">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h3.086a1.5 1.5 0 011.06.44l.915.914A1.5 1.5 0 009.62 5H12.5A1.5 1.5 0 0114 6.5v6A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5v-8z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
    </svg>${SHOW_IN_FOLDER_LABEL}`;
    showBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.showInFolder(photo.localPath);
    });
    thumbWrap.appendChild(showBtn);
  }

  // Caption
  const caption = document.createElement('div');
  caption.className = 'photo-caption';

  const perf = document.createElement('div');
  perf.className = 'caption-performer';
  perf.textContent = photo.performer || photo.filename;
  caption.appendChild(perf);

  if (photo.gender) {
    const meta = document.createElement('div');
    meta.className = 'caption-meta';
    meta.textContent = photo.gender;
    caption.appendChild(meta);
  }

  if (photo.categories.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'caption-tags';
    photo.categories.slice(0, 3).forEach(cat => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = cat;
      tags.appendChild(tag);
    });
    caption.appendChild(tags);
  }

  card.appendChild(thumbWrap);
  card.appendChild(caption);

  card.addEventListener('click', () => openLightbox(idx));
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(idx); }
  });

  return card;
}

function makeErrorPlaceholder(msg) {
  const div = document.createElement('div');
  div.className = 'thumb-error';
  div.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" width="24">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" stroke="#4b5563" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="4" y1="22" x2="4" y2="15" stroke="#4b5563" stroke-width="1.5"/>
    </svg>
    <span>${msg || 'No preview'}</span>`;
  return div;
}

// ── Filter sidebar ────────────────────────────────────────────────────────
function updateFilterSection() {
  if (state.allPhotos.length === 0) {
    hide(el.filterSection);
    return;
  }
  show(el.filterSection);
  rebuildCategoryList(el.categorySearch.value.toLowerCase());
  rebuildPerformerList(el.performerSearch.value.toLowerCase());
}

function rebuildCategoryList(filterText = '') {
  // Count categories in allPhotos (unfiltered by category filter itself)
  const counts = new Map();
  for (const p of state.allPhotos) {
    for (const c of p.categories) {
      counts.set(c, (counts.get(c) || 0) + 1);
    }
  }
  const sorted = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([name]) => !filterText || name.toLowerCase().includes(filterText));

  renderCheckList(el.filterCategoryList, sorted, state.filters.categories, (val, checked) => {
    if (checked) state.filters.categories.add(val);
    else state.filters.categories.delete(val);
    applyFiltersAndRender();
  });
}

function rebuildPerformerList(filterText = '') {
  const counts = new Map();
  for (const p of state.allPhotos) {
    if (p.performer) counts.set(p.performer, (counts.get(p.performer) || 0) + 1);
  }
  const sorted = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([name]) => !filterText || name.toLowerCase().includes(filterText));

  renderCheckList(el.filterPerformerList, sorted, state.filters.performers, (val, checked) => {
    if (checked) state.filters.performers.add(val);
    else state.filters.performers.delete(val);
    applyFiltersAndRender();
  });
}

function renderCheckList(container, entries, activeSet, onChange) {
  const frag = document.createDocumentFragment();
  for (const [name, count] of entries) {
    const item = document.createElement('label');
    item.className = 'filter-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = activeSet.has(name);
    cb.addEventListener('change', () => onChange(name, cb.checked));

    const lbl = document.createElement('span');
    lbl.className = 'filter-item-label';
    lbl.textContent = name;
    lbl.title = name;

    const cnt = document.createElement('span');
    cnt.className = 'filter-item-count';
    cnt.textContent = count;

    item.appendChild(cb);
    item.appendChild(lbl);
    item.appendChild(cnt);
    frag.appendChild(item);
  }
  container.innerHTML = '';
  container.appendChild(frag);
}

// ── Lightbox ──────────────────────────────────────────────────────────────
function openLightbox(idx) {
  state.lightbox.open = true;
  state.lightbox.index = idx;
  show(el.lightbox);
  renderLightboxPhoto();
  document.addEventListener('keydown', onLightboxKey);
}

function closeLightbox() {
  state.lightbox.open = false;
  hide(el.lightbox);
  el.lbImage.src = '';
  document.removeEventListener('keydown', onLightboxKey);
}

function renderLightboxPhoto() {
  const { index } = state.lightbox;
  const photos = state.filteredPhotos;
  if (!photos.length) return;

  const photo = photos[index];

  // Show spinner while loading
  el.lbSpinner.classList.remove('hidden');
  el.lbImage.style.opacity = '0';
  el.lbImage.onload  = () => { el.lbSpinner.classList.add('hidden'); el.lbImage.style.opacity = '1'; };
  el.lbImage.onerror = () => { el.lbSpinner.classList.add('hidden'); el.lbImage.style.opacity = '0.3'; };
  el.lbImage.src = photo.galleryUrl || '';
  el.lbImage.alt = photo.performer || photo.filename;

  // Metadata
  el.lbFilename.textContent = photo.filename;
  const parts = [photo.performer, photo.gender, ...photo.categories].filter(Boolean);
  el.lbDetails.textContent = parts.join('  ·  ');
  el.lbCounter.textContent = `${index + 1} / ${photos.length}`;

  // Nav buttons
  el.lbPrev.style.opacity = index > 0 ? '1' : '0.3';
  el.lbNext.style.opacity = index < photos.length - 1 ? '1' : '0.3';
}

function lightboxStep(delta) {
  const photos = state.filteredPhotos;
  const next = state.lightbox.index + delta;
  if (next < 0 || next >= photos.length) return;
  state.lightbox.index = next;
  renderLightboxPhoto();
}

function onLightboxKey(e) {
  if (e.key === 'Escape')       closeLightbox();
  if (e.key === 'ArrowLeft')    lightboxStep(-1);
  if (e.key === 'ArrowRight')   lightboxStep(1);
}

// ── Stats ─────────────────────────────────────────────────────────────────
function updateStats() {
  const total    = state.allPhotos.length;
  const showing  = state.filteredPhotos.length;
  const hasFilter = showing < total;

  if (total === 0) {
    el.statsText.textContent = 'No photos loaded';
  } else if (hasFilter) {
    el.statsText.textContent = `Showing ${showing.toLocaleString()} of ${total.toLocaleString()} photos`;
  } else {
    el.statsText.textContent = `${total.toLocaleString()} photos`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function show(el) { el.style.display = ''; }
function hide(el) { el.style.display = 'none'; }

function showLoading(msg) {
  el.loadingText.textContent = msg || 'Loading…';
  hide(el.welcome);
  hide(el.grid);
  hide(el.noResults);
  show(el.loading);
}

function hideLoading() {
  hide(el.loading);
}

function shortenPath(p) {
  if (p.length <= 38) return p;
  const sep = p.includes('/') ? '/' : '\\';
  const parts = p.split(sep);
  if (parts.length <= 3) return p;
  return parts[0] + sep + '…' + sep + parts[parts.length - 2] + sep + parts[parts.length - 1];
}

function clearAllFilters() {
  state.filters.volumes.clear();
  state.filters.gender = 'all';
  state.filters.categories.clear();
  state.filters.performers.clear();
  state.filters.search = '';
  el.globalSearch.value = '';
  // Reset pills
  el.filterVolume.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p.dataset.value === 'all'));
  el.filterGender.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p.dataset.value === 'all'));
  applyFiltersAndRender();
}

// ── Thumbnail size ────────────────────────────────────────────────────────
function setThumbSize(size) {
  state.thumbSize = size;
  el.grid.style.setProperty('--thumb-size', size + 'px');
}

// ── Wire up events ────────────────────────────────────────────────────────
el.btnVol1.addEventListener('click', () => selectVolume(1));
el.btnVol2.addEventListener('click', () => selectVolume(2));

el.globalSearch.addEventListener('input', () => {
  state.filters.search = el.globalSearch.value;
  applyFiltersAndRender();
});

el.sortSelect.addEventListener('change', () => {
  state.sort = el.sortSelect.value;
  applyFiltersAndRender();
});

el.thumbSizeInput.addEventListener('input', () => {
  setThumbSize(Number(el.thumbSizeInput.value));
});

el.btnClearFilters.addEventListener('click', clearAllFilters);

// Volume pills
el.filterVolume.addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  el.filterVolume.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  const val = pill.dataset.value;
  state.filters.volumes.clear();
  if (val !== 'all') state.filters.volumes.add(val);
  applyFiltersAndRender();
});

// Gender pills
el.filterGender.addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  el.filterGender.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  state.filters.gender = pill.dataset.value;
  applyFiltersAndRender();
});

// Category search
el.categorySearch.addEventListener('input', () => {
  rebuildCategoryList(el.categorySearch.value.toLowerCase());
});

// Performer search
el.performerSearch.addEventListener('input', () => {
  rebuildPerformerList(el.performerSearch.value.toLowerCase());
});

// Lightbox controls
el.lbClose.addEventListener('click', closeLightbox);
el.lbBackdrop.addEventListener('click', closeLightbox);
el.lbPrev.addEventListener('click', () => lightboxStep(-1));
el.lbNext.addEventListener('click', () => lightboxStep(1));

// Swipe support for touch screens
let touchStartX = 0;
el.lightbox.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; });
el.lightbox.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) lightboxStep(dx < 0 ? 1 : -1);
});

// ── Init ──────────────────────────────────────────────────────────────────
setThumbSize(state.thumbSize);
show(el.welcome);
hide(el.loading);
hide(el.grid);
hide(el.noResults);
