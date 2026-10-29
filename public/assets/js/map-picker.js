// "Set on map": pick a pickup or drop-off point by tapping a map or searching.
// Free OpenStreetMap map (Leaflet + Nominatim): no account or key needed. Search runs on submit,
// never as you type, to respect Nominatim's usage policy.
import { icon } from './ui/ui.js';

const SYDNEY = { lat: -33.8688, lng: 151.2093 };
// Rough Sydney service-area box (placeholder until the client confirms the real area)
const BOUNDS = { south: -34.1, north: -33.55, west: 150.65, east: 151.35 };
const inArea = (lat, lng) => lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east;
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text) n.textContent = text; return n; };
const loadScript = (src) => new Promise((resolve, reject) => { const s = Object.assign(document.createElement('script'), { src, async: true }); s.onload = resolve; s.onerror = () => reject(new Error('script')); document.head.appendChild(s); });

// ---------------------------------------------------------------- OpenStreetMap provider (dev fallback)
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
let leafletPromise;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: LEAFLET_CSS }));
    leafletPromise = loadScript(LEAFLET_JS).then(() => window.L, (e) => { leafletPromise = null; throw e; });
  }
  return leafletPromise;
}
async function nominatim(path, params) {
  const url = `https://nominatim.openstreetmap.org/${path}?${new URLSearchParams({ format: 'jsonv2', 'accept-language': 'en-AU', ...params })}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
  return res.json();
}
function osmLabel(result) {
  const a = result.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const place = a.amenity || a.building || a.tourism || a.shop || '';
  const suburb = a.suburb || a.neighbourhood || a.city_district || a.town || a.city || '';
  const parts = [place, street, suburb && `${suburb} ${a.state === 'New South Wales' ? 'NSW' : (a.state || '')}`.trim()].filter(Boolean);
  return parts.length ? parts.join(', ') : (result.display_name || '').split(',').slice(0, 3).join(',').trim();
}
async function osmProvider(container, { onPoint }) {
  const L = await loadLeaflet();
  const map = L.map(container, { center: [SYDNEY.lat, SYDNEY.lng], zoom: 11 });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  let pin;
  map.on('click', (e) => onPoint(e.latlng.lat, e.latlng.lng, { pan: false }));
  return {
    place(lat, lng, pan) {
      if (!pin) {
        pin = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: 'mappin', html: '<span class="mappin__dot"></span>', iconSize: [28, 36], iconAnchor: [14, 34] }) }).addTo(map);
        pin.on('dragend', () => { const p = pin.getLatLng(); onPoint(p.lat, p.lng, { pan: false }); });
      } else pin.setLatLng([lat, lng]);
      if (pan) map.setView([lat, lng], Math.max(map.getZoom(), 16));
    },
    async reverse(lat, lng) { return osmLabel(await nominatim('reverse', { lat, lon: lng, zoom: 18, addressdetails: 1 })); },
    async search(term) {
      const rows = await nominatim('search', { q: term, countrycodes: 'au', limit: 5, addressdetails: 1, viewbox: `${BOUNDS.west},${BOUNDS.north},${BOUNDS.east},${BOUNDS.south}` });
      return rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: osmLabel(r) }));
    },
    resize() { map.invalidateSize(); },
    destroy() { try { map.remove(); } catch { /* ignore */ } },
  };
}

// ---------------------------------------------------------------- Dialog
/** onPick(label, lat, lng) runs only when the person confirms. The dialog removes itself when closed. */
export function openMapPicker({ title, onPick }) {
  const dialog = el('dialog', 'dialog mapdlg');
  dialog.setAttribute('aria-labelledby', 'mapdlg-title');
  const h = el('h3', '', title); h.id = 'mapdlg-title';

  const search = el('form', 'mapdlg__search');
  search.setAttribute('role', 'search');
  const q = el('input', 'input'); Object.assign(q, { type: 'search', placeholder: 'Search an address or place in Sydney', autocomplete: 'off' });
  q.setAttribute('aria-label', 'Search an address or place');
  const go = el('button', 'btn btn--ghost btn--sm', 'Search'); go.type = 'submit';
  const locate = el('button', 'btn btn--ghost btn--sm'); locate.type = 'button'; locate.append(icon('map-pin'), 'Use my location');
  search.append(q, go, locate);

  const mapBox = el('div', 'mapdlg__map'); mapBox.setAttribute('aria-label', 'Map. Tap to drop a pin, or use the search box.');
  const status = el('p', 'mapdlg__status', 'Loading the map…'); status.setAttribute('aria-live', 'polite');
  const results = el('ul', 'mapdlg__results'); results.hidden = true;
  const actions = el('div', 'dialog__actions');
  const cancel = el('button', 'btn btn--ghost', 'Cancel'); cancel.type = 'button';
  const ok = el('button', 'btn btn--primary', 'Use this location'); ok.type = 'button'; ok.disabled = true;
  actions.append(cancel, ok);
  dialog.append(h, search, results, mapBox, status, actions);
  document.body.appendChild(dialog);

  let provider = null; let chosen = null; let token = 0;
  const close = () => { provider?.destroy(); dialog.close(); dialog.remove(); };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  ok.addEventListener('click', () => { if (chosen) onPick(chosen.label, chosen.lat, chosen.lng); close(); });
  const setStatus = (text, warn = false) => { status.textContent = text; status.classList.toggle('is-warn', warn); };

  async function setPoint(lat, lng, { pan = true, label = '' } = {}) {
    if (!provider) return;
    const mine = ++token;
    provider.place(lat, lng, pan);
    ok.disabled = true; chosen = null;
    setStatus(label || 'Finding the address…');
    let text = label;
    if (!text) {
      try { text = await provider.reverse(lat, lng); } catch { text = ''; }
      text = text || `Pinned location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    }
    if (mine !== token) return; // a newer pin replaced this one
    chosen = { label: text, lat, lng };
    ok.disabled = false;
    const inside = inArea(lat, lng);
    setStatus(inside ? text : `${text}. This is outside our Sydney area, so we will quote it manually.`, !inside);
  }

  search.addEventListener('submit', async (e) => {
    e.preventDefault();
    const term = q.value.trim(); if (!term || !provider) return;
    setStatus('Searching…');
    try {
      const hits = await provider.search(term);
      results.replaceChildren(); results.hidden = true;
      if (!hits.length) { setStatus('No match found. Try a street name and suburb, or tap the map.', true); return; }
      if (hits.length === 1) { await setPoint(hits[0].lat, hits[0].lng, { label: hits[0].label }); return; }
      hits.forEach((hit) => {
        const li = el('li'); const b = el('button', '', hit.label); b.type = 'button';
        b.addEventListener('click', () => { results.hidden = true; setPoint(hit.lat, hit.lng, { label: hit.label }); });
        li.appendChild(b); results.appendChild(li);
      });
      results.hidden = false;
      setStatus('Choose a result, or tap the map.');
    } catch { setStatus('Search is unavailable right now. Tap the map instead, or type the address in the form.', true); }
  });

  locate.addEventListener('click', () => {
    if (!navigator.geolocation) { setStatus('Your browser cannot share its location. Tap the map instead.', true); return; }
    setStatus('Asking for your location…');
    navigator.geolocation.getCurrentPosition(
      (p) => setPoint(p.coords.latitude, p.coords.longitude),
      () => setStatus('Location is off or blocked. Tap the map instead.', true),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  dialog.showModal();
  q.focus();
  osmProvider(mapBox, { onPoint: setPoint }).then((p) => {
    provider = p;
    setTimeout(() => p.resize(), 50);
    setStatus('Tap the map to drop a pin, or search above.');
  }).catch((err) => {
    const why = 'The map could not load. Check your connection, or close this and type the address in the form.';
    mapBox.replaceChildren(el('p', 'mapdlg__fail', why));
    setStatus('');
  });
}
