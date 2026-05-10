function fmtPrice(n) {
  if (!n) return '—';
  return '₹' + n.toLocaleString('en-IN');
}

function metroClass(km) {
  if (km === null) return 'none';
  if (km <= 0.5) return 'close';
  if (km <= 2) return 'medium';
  return 'far';
}

function metroLabel(km) {
  if (km === null) return 'Metro N/A';
  return km + ' km';
}

function metroEmoji(km) {
  if (km === null) return '⬜';
  if (km <= 0.5) return '🟢';
  if (km <= 2) return '🟡';
  return '🔴';
}

function getRoomPrice(pg, type) {
  for (const [k, v] of Object.entries(pg.rooms || {})) {
    if (k.toLowerCase().includes(type)) return v;
  }
  return null;
}

function getSinglePrice(pg) {
  for (const [k, v] of Object.entries(pg.rooms || {})) {
    const key = k.toLowerCase();
    if (key.includes('single') || key.includes('private')) return v;
  }
  return null;
}

function getDoublePrice(pg) {
  for (const [k, v] of Object.entries(pg.rooms || {})) {
    const key = k.toLowerCase();
    if (key.includes('twin') || key.includes('two sharing')) return v;
  }
  return null;
}

const FAVORITES_KEY = 'blrstayFavorites';
const DISLIKES_KEY = 'blrstayDislikes';

function readStoredSet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch (error) {
    return new Set();
  }
}

function writeStoredSet(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify([...values]));
  } catch (error) {
    // Ignore storage failures so the page still works without persistence.
  }
}

function getFavoritesSet() {
  return readStoredSet(FAVORITES_KEY);
}

function getDislikesSet() {
  return readStoredSet(DISLIKES_KEY);
}

function getPreference(url) {
  const favorites = getFavoritesSet();
  const dislikes = getDislikesSet();
  if (favorites.has(url)) return 'favorite';
  if (dislikes.has(url)) return 'disliked';
  return '';
}

function setPreference(url, preference) {
  const favorites = getFavoritesSet();
  const dislikes = getDislikesSet();

  favorites.delete(url);
  dislikes.delete(url);

  if (preference === 'favorite') {
    favorites.add(url);
  } else if (preference === 'dislike') {
    dislikes.add(url);
  }

  writeStoredSet(FAVORITES_KEY, favorites);
  writeStoredSet(DISLIKES_KEY, dislikes);
}

function togglePreference(url, preference) {
  const current = getPreference(url);
  setPreference(url, current === preference ? '' : preference);
  filterAndRender();
}

function exportData() {
  const data = {
    favorites: [...getFavoritesSet()],
    dislikes: [...getDislikesSet()],
    version: 1,
    timestamp: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blr-pg-finder-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.favorites) writeStoredSet(FAVORITES_KEY, new Set(data.favorites));
      if (data.dislikes) writeStoredSet(DISLIKES_KEY, new Set(data.dislikes));
      alert('Backup restored successfully!');
      filterAndRender();
    } catch (err) {
      alert('Failed to import: Invalid JSON file.');
    }
  };
  reader.readAsText(file);
  input.value = ''; // Reset input
}

function getEffectivePrice(pg, singleOnly) {
  if (singleOnly) return getSinglePrice(pg);
  return pg.min_price ?? getSinglePrice(pg) ?? getDoublePrice(pg);
}

function estimateTargetDistanceKm(pg) {
  const locality = (pg.locality || '').toLowerCase();
  const metro = (pg.metro || '').toLowerCase();
  const matches = [
    [/indiranagar|defence colony|domlur/, 0.9],
    [/ulsoor|halasuru/, 2.1],
    [/cv raman|ejipura|m g road|mahatma gandhi road|vivek nagar|lido/, 3.0],
    [/koramangala|sg palya|btm layout|jayanagar|jp nagar/, 4.8],
    [/marathahalli|brookefield|hoodi|mahadevapura|whitefield|itpl/, 11.5],
    [/bellandur|sarjapur|electronic city|bommanahalli|hsr layout/, 13.5],
    [/nagavara|hebbal|banaswadi|kalyan nagar|malleshwaram/, 8.0],
  ];

  for (const [pattern, distance] of matches) {
    if (pattern.test(locality) || pattern.test(metro)) return distance;
  }

  return null;
}

function renderCard(pg, filters) {
  const single = getSinglePrice(pg);
  const twin = getDoublePrice(pg);
  const mc = metroClass(pg.metro_km);
  const isGirlsBoys = pg.for && pg.for.toLowerCase().includes('girl');
  const tagClass = isGirlsBoys ? 'coed' : 'boys';
  const tagLabel = isGirlsBoys ? 'Coed' : 'Boys';
  const hasImg = pg.image &&
    pg.image.trim() !== '' &&
    !pg.image.includes('img-not-uploaded.svg');
  const targetDistance = estimateTargetDistanceKm(pg);
  const singleOnly = filters.singleOnly;
  const preference = getPreference(pg.url);

  //
  const cleanName = pg.name.replace('/Paying Guest', '').replace('PG/Paying Guest', 'PG');
  const origin = encodeURIComponent(`${cleanName}, ${pg.locality}, Bangalore`);
  const metroDest = encodeURIComponent(`${pg.metro}, Bangalore`);
  const officeDest = encodeURIComponent('Samhita Plaza, 248, 80 Feet Rd, Defence Colony, Indiranagar, Bangalore');

  // 1. Use the REAL Google Maps domains
  const dirBaseUrl = 'https://www.google.com/maps/dir';
  const searchBaseUrl = 'https://www.google.com/maps/search/?api=1&query=';

  // 2. Properly nested data string: Transit (!3e3) + Depart at May 12, 2026 (!8j1778504400)
  // Maps requires the time parameters to be wrapped in specific !4m and !2m containers to read them
  const transitDataParams = 'data=!4m6!4m5!2m3!6e0!7e2!8j1778590800!3e3';

  // 3. Updated URL structures (removed 'am=t' which causes conflicts)
  const metroUrl = `${dirBaseUrl}/${origin}/${metroDest}/data=!4m2!4m1!3e2`; // !3e2 forces Walking
  const officeUrl = `${dirBaseUrl}/${origin}/${officeDest}/${transitDataParams}`;
  const propertyUrl = `${searchBaseUrl}${origin}`;

  return `
  <div class="card ${preference}" id="pg-${pg.url.slice(-8)}">
    <a href="${propertyUrl}" target="_blank" class="card-img-link">
      ${hasImg
      ? `<img class="card-img" src="${pg.image}" alt="${pg.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="card-img-placeholder" style="display:none">🏠</div>`
      : `<div class="card-img-placeholder">🏠</div>`}
    </a>
    <div class="card-body">
      <a href="${propertyUrl}" target="_blank" class="card-name-link">
        <div class="card-name">${cleanName}</div>
      </a>
      <div class="card-locality">📍 ${pg.locality}</div>
      <div class="card-tags">
        <span class="tag ${tagClass}">${tagLabel}</span>
        ${pg.food === 'Included' ? '<span class="tag food">🍽 Food Incl.</span>' : ''}
        ${pg.food === 'Extra' ? '<span class="tag">Food Extra</span>' : ''}
        ${single ? '<span class="tag single">Single room</span>' : ''}
      </div>
      
      <div class="card-prices">
        ${single ? `<div class="price-item"><div class="price-label">Single</div><div class="price-val">${fmtPrice(single)}</div></div>` : ''}
        ${!singleOnly && twin ? `<div class="price-item"><div class="price-label">Twin Sharing</div><div class="price-val">${fmtPrice(twin)}</div></div>` : ''}
        ${!single && !twin ? `<div class="price-item"><div class="price-label">From</div><div class="price-val">${fmtPrice(pg.min_price)}</div></div>` : ''}
      </div>

      <div class="card-actions directions">
        <a href="${metroUrl}" target="_blank" class="direction-btn metro" title="Directions to nearest metro">📍 To Metro</a>
        <a href="${officeUrl}" target="_blank" class="direction-btn office" title="Directions to Indiranagar Office">🏢 To Office</a>
      </div>

      <div class="card-actions preferences">
        <button class="action-btn favorite ${preference === 'favorite' ? 'active' : ''}" type="button" onclick="togglePreference('${pg.url}', 'favorite')">${preference === 'favorite' ? 'Favorited' : 'Favorite'}</button>
        <button class="action-btn dislike ${preference === 'disliked' ? 'active' : ''}" type="button" onclick="togglePreference('${pg.url}', 'dislike')">${preference === 'disliked' ? 'Disliked' : 'Dislike'}</button>
      </div>

      ${targetDistance !== null ? `<div class="card-tags"><span class="tag proximity">~${targetDistance.toFixed(1)} km from Defence Colony, Indiranagar</span></div>` : ''}
      
      <div class="card-metro ${mc === 'far' ? 'far' : ''}">
        ${metroEmoji(pg.metro_km)} 
        ${pg.metro
      ? `<span>${metroLabel(pg.metro_km)} · ${pg.metro.replace('Metro Station', 'Metro').replace('Upcoming Purple Line ', '').replace('Upcoming Yellow Line ', '').replace('Upcoming ', '')}</span>`
      : '<span style="color:var(--muted)">Metro info unavailable</span>'}
      </div>
      
      <div style="margin-top: 12px; font-size: 11px; opacity: 0.6;">
         <a href="${propertyUrl}" target="_blank" style="color: inherit; text-decoration: underline;">View on Google Maps ↗</a>
      </div>
    </div>
  </div>`;
}

function getFilters() {
  return {
    search: document.getElementById('searchInput').value.trim().toLowerCase(),
    budget: parseInt(document.getElementById('budgetSlider').value),
    sortBy: document.getElementById('sortSelect').value,
    singleOnly: document.getElementById('cbSingleOnly').checked,
    coed: document.getElementById('cbCoed').checked,
    boys: document.getElementById('cbBoys').checked,
    favoritesOnly: document.getElementById('cbFavorites').checked,
    foodAny: document.getElementById('cbFoodAny').checked,
    foodIncl: document.getElementById('cbFoodIncl').checked,
    locality: document.getElementById('localitySelect').value,
    metroClose: document.getElementById('metroClose').checked,
    metroMed: document.getElementById('metroMed').checked,
    metroFar: document.getElementById('metroFar').checked,
  };
}

function filterAndRender() {
  const f = getFilters();
  let pgs = ALL_PGS.filter(pg => {
    const singlePrice = getSinglePrice(pg);
    const effectivePrice = getEffectivePrice(pg, f.singleOnly);

    // Single-room mode requires a single-room listing and uses that price for all checks.
    if (f.singleOnly && singlePrice === null) return false;

    // Budget follows the active room mode.
    if (effectivePrice === null || effectivePrice > f.budget) return false;

    // Gender
    const isCoed = pg.for && pg.for.toLowerCase().includes('girl');
    if (isCoed && !f.coed) return false;
    if (!isCoed && !f.boys) return false;

    // Food
    if (f.foodIncl && !f.foodAny && pg.food !== 'Included') return false;

    return true;
  });

  // Stage 1b: Update the locality dropdown based on the partial filter results
  populateLocalities(pgs);

  // Stage 2: Apply final locality filter for rendering
  pgs = pgs.filter(pg => {
    // Locality
    if (f.locality && pg.locality !== f.locality) return false;

    // Favorites
    const pref = getPreference(pg.url);
    if (f.favoritesOnly && pref !== 'favorite') return false;
    if (!f.favoritesOnly && pref === 'disliked') return false; // Hide disliked by default

    // Search
    if (f.search) {
      const hay = (pg.name + ' ' + pg.locality + ' ' + (pg.metro || '')).toLowerCase();
      if (!hay.includes(f.search)) return false;
    }

    // Metro distance filter (only if any checkbox checked)
    const anyMetro = f.metroClose || f.metroMed || f.metroFar;
    if (anyMetro) {
      const mc = metroClass(pg.metro_km);
      if (f.metroClose && mc === 'close') return true;
      if (f.metroMed && mc === 'medium') return true;
      if (f.metroFar && (mc === 'far' || mc === 'none')) return true;
      return false;
    }

    return true;
  });

  // Sort
  if (f.sortBy === 'price_asc') {
    pgs.sort((a, b) => (getEffectivePrice(a, f.singleOnly) || 99999) - (getEffectivePrice(b, f.singleOnly) || 99999));
  } else if (f.sortBy === 'price_desc') {
    pgs.sort((a, b) => (getEffectivePrice(b, f.singleOnly) || 0) - (getEffectivePrice(a, f.singleOnly) || 0));
  } else if (f.sortBy === 'metro_asc') {
    pgs.sort((a, b) => {
      const ak = a.metro_km === null ? 99 : a.metro_km;
      const bk = b.metro_km === null ? 99 : b.metro_km;
      return ak - bk;
    });
  } else if (f.sortBy === 'office_asc') {
    pgs.sort((a, b) => {
      const ad = estimateTargetDistanceKm(a) ?? 999;
      const bd = estimateTargetDistanceKm(b) ?? 999;
      return ad - bd;
    });
  } else if (f.sortBy === 'office_price_asc') {
    pgs.sort((a, b) => {
      const ad = estimateTargetDistanceKm(a) ?? 999;
      const bd = estimateTargetDistanceKm(b) ?? 999;
      if (ad !== bd) return ad - bd;
      return (getEffectivePrice(a, f.singleOnly) || 99999) - (getEffectivePrice(b, f.singleOnly) || 99999);
    });
  } else if (f.sortBy === 'office_price_desc') {
    pgs.sort((a, b) => {
      const ad = estimateTargetDistanceKm(a) ?? 999;
      const bd = estimateTargetDistanceKm(b) ?? 999;
      if (ad !== bd) return ad - bd;
      return (getEffectivePrice(b, f.singleOnly) || 0) - (getEffectivePrice(a, f.singleOnly) || 0);
    });
  }

  document.getElementById('resultCount').textContent = `${pgs.length} PGs found`;

  const grid = document.getElementById('grid');
  if (pgs.length === 0) {
    grid.innerHTML = `<div class="no-results"><span class="emoji">🔍</span><p>No PGs match your filters.<br>Try adjusting your budget or filters.</p></div>`;
    return;
  }
  grid.innerHTML = pgs.map(pg => renderCard(pg, f)).join('');
}

// Populate localities
function populateLocalities(pgs = ALL_PGS) {
  const sel = document.getElementById('localitySelect');
  const current = sel.value;
  const locs = [...new Set(pgs.map(p => p.locality))].sort();

  sel.innerHTML = '<option value="">All Localities</option>';
  locs.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = l;
    sel.appendChild(opt);
  });

  // Restore selection if it's still available
  if (locs.includes(current)) {
    sel.value = current;
  }
}

// Budget slider sync
const slider = document.getElementById('budgetSlider');
const display = document.getElementById('priceDisplay');
const track = document.getElementById('trackFill');

function updateSlider() {
  const val = parseInt(slider.value);
  const min = parseInt(slider.min);
  const max = parseInt(slider.max);
  const pct = ((val - min) / (max - min)) * 100;
  track.style.left = '0';
  track.style.width = pct + '%';
  display.textContent = val >= 45000 ? 'Any budget' : `Up to ₹${val.toLocaleString('en-IN')}`;
}

slider.addEventListener('input', () => { updateSlider(); filterAndRender(); });

// Food checkbox logic
document.getElementById('cbFoodAny').addEventListener('change', function () {
  if (this.checked) document.getElementById('cbFoodIncl').checked = false;
  filterAndRender();
});
document.getElementById('cbFoodIncl').addEventListener('change', function () {
  if (this.checked) document.getElementById('cbFoodAny').checked = false;
  filterAndRender();
});

// All other controls
['searchInput', 'sortSelect', 'localitySelect', 'cbCoed', 'cbBoys', 'cbSingleOnly', 'cbFavorites', 'metroClose', 'metroMed', 'metroFar']
  .forEach(id => document.getElementById(id).addEventListener('input', filterAndRender));
['sortSelect', 'localitySelect', 'cbCoed', 'cbBoys', 'cbSingleOnly', 'cbFavorites', 'metroClose', 'metroMed', 'metroFar']
  .forEach(id => document.getElementById(id).addEventListener('change', filterAndRender));

function clearFilters() {
  document.getElementById('searchInput').value = '';
  slider.value = 20000;
  document.getElementById('sortSelect').value = 'relevance';
  document.getElementById('cbCoed').checked = true;
  document.getElementById('cbBoys').checked = true;
  document.getElementById('cbFavorites').checked = false;
  document.getElementById('cbSingleOnly').checked = false;
  document.getElementById('cbFoodAny').checked = true;
  document.getElementById('cbFoodIncl').checked = false;
  document.getElementById('localitySelect').value = '';
  document.getElementById('metroClose').checked = false;
  document.getElementById('metroMed').checked = false;
  document.getElementById('metroFar').checked = false;
  updateSlider();
  filterAndRender();
}

// Init
populateLocalities();
updateSlider();
filterAndRender();
