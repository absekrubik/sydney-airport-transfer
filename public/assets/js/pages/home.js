import { initSteppers, setStepper, setFieldError, focusFirstError, formatMoney, loadTrip, saveTrip, localDate, setVehicleImage } from '../ui/ui.js';
import { api, tripBody } from '../api.js';
import { fillLocations, initTripControls, readTrip, writeTrip } from '../trip-controls.js';
import { initCommon } from '../common.js';
import { pop } from '../motion.js';

const form = document.getElementById('home-booking-form');
const $ = (name) => form.elements[name];

// Build elements with DOM methods (not innerHTML) so data can never inject markup.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const INTERNATIONAL = 'Sydney Airport (SYD) – International Terminal';

async function renderRoutes() {
  const host = document.getElementById('popular-routes');
  try {
    const { routes, sample } = await api('GET', '/api/routes');
    const note = document.getElementById('routes-note');
    if (note) note.hidden = !sample;
    routes.filter((r) => r.from === INTERNATIONAL).slice(0, 4).forEach((r) => {
      const row = el('a', 'board__row');
      row.setAttribute('role', 'listitem');
      row.href = `booking.html?pickup=${encodeURIComponent(r.from)}&destination=${encodeURIComponent(r.to)}`;
      const path = el('span', 'board__path');
      path.append('Sydney Airport', el('span', '', 'to'), r.to);
      const fare = el('span', 'board__fare');
      fare.append(formatMoney(r.fares.sedan ?? r.fromCents), el('small', '', 'Book this route'));
      row.append(path, fare);
      host.appendChild(row);
    });
  } catch { host.appendChild(el('p', 'text-muted', 'Routes will appear here once the booking system is reachable.')); }
}

async function renderFleet() {
  const host = document.getElementById('fleet-preview');
  try {
    const { vehicles } = await api('GET', '/api/vehicle-categories');
    vehicles.forEach((v) => {
      const tile = el('article');
      const art = el('div', 'fleet__img');
      const img = el('img');
      Object.assign(img, { alt: v.name, loading: 'lazy', width: 400, height: 300 });
      setVehicleImage(img, v);
      art.appendChild(img);
      tile.append(art, el('h3', 'fleet__name', v.name), el('p', 'fleet__meta', `${v.example ? `${v.example}. ` : ""}Up to ${v.passengers} passengers and ${v.luggage} bags.`));
      host.appendChild(tile);
    });
  } catch { host.appendChild(el('p', 'text-muted', 'Our vehicles will appear here once the booking system is reachable.')); }
}

/** Live "From $X" hint: the server prices the trip (same engine as the booking), so what you see is what you pay. */
let hintController = null; let hintTimer = null;
function updateFareHint() {
  clearTimeout(hintTimer);
  const hint = document.getElementById('fare-hint');
  const trip = readTrip(form);
  if (!trip.pickup || !trip.destination) { hint.textContent = 'Enter your route to see a fare.'; return; }
  hintTimer = setTimeout(async () => {
    hintController?.abort(); hintController = new AbortController();
    try {
      const q = await api('POST', '/api/quotes', tripBody(trip), { signal: hintController.signal });
      const priced = q.results.filter((r) => r.status === 'ok').sort((a, b) => a.quote.total - b.quote.total);
      hint.replaceChildren();
      if (priced.length) {
        const strong = el('strong', '', `From ${formatMoney(priced[0].quote.total)}`); pop(strong);
        hint.append(strong, `${priced[0].category.name}, ${trip.tripType === 'return' ? 'return' : 'one way'}. GST included.${q.sample ? ' Sample fare.' : ''}`);
      } else if (q.results.every((r) => r.status === 'too_small')) {
        hint.textContent = 'Your group needs more than one vehicle. Continue and we will quote it.';
      } else hint.textContent = 'No fixed fare for this route yet. Continue to request a quote.';
    } catch (e) {
      if (e.name === 'AbortError') return;
      hint.textContent = 'Check your trip details to see a fare.';
    }
  }, 350);
}

function validate() {
  let ok = true;
  const trip = readTrip(form);
  ['pickup', 'destination', 'date', 'time', 'returnDate', 'returnTime'].forEach((n) => setFieldError($(n), ''));
  const need = (name, msg) => { if (!trip[name]) { setFieldError($(name), msg); ok = false; } };
  need('pickup', 'Enter where we pick you up'); need('destination', 'Enter where you are going');
  need('date', 'Choose a date'); need('time', 'Choose a time');
  if (trip.tripType === 'return') { need('returnDate', 'Choose a return date'); need('returnTime', 'Choose a return time'); }
  if (trip.pickup && trip.pickup.toLowerCase() === trip.destination.toLowerCase()) { setFieldError($('destination'), 'Destination must be different from pickup'); ok = false; }
  if (trip.date && trip.date < localDate()) { setFieldError($('date'), 'That date has passed'); ok = false; }
  if (trip.tripType === 'return' && trip.returnDate && trip.date && `${trip.returnDate}T${trip.returnTime || '00:00'}` <= `${trip.date}T${trip.time || '00:00'}`) {
    setFieldError($('returnDate'), 'Return must be after pickup'); ok = false;
  }
  return ok;
}

// Looping video with a pause button for anyone who wants it.
function initVideo() {
  const video = document.getElementById('journey-video');
  const toggle = document.getElementById('journey-toggle');
  if (!video || !toggle) return;
  const setState = (paused) => { toggle.textContent = paused ? 'Play animation' : 'Pause animation'; toggle.setAttribute('aria-pressed', String(paused)); };
  toggle.addEventListener('click', () => { if (video.paused) { video.play(); setState(false); } else { video.pause(); setState(true); } });
}

async function init() {
  api('GET', '/api/locations').then(({ locations }) => fillLocations(document.getElementById('locations'), locations.map((l) => l.label))).catch(() => {});
  renderRoutes(); renderFleet();

  const refresh = () => { updateFareHint(); saveTrip(readTrip(form)); };
  initSteppers(form, refresh);
  initTripControls(form, refresh);

  // Restore the last trip from this tab (for example after coming back from the booking page)
  const saved = loadTrip();
  if (saved.pickup || saved.destination) {
    writeTrip(form, saved, setStepper);
    ['pickup', 'destination', 'date'].forEach((n) => $(n).dispatchEvent(new Event('input')));
    writeTrip(form, saved, setStepper); // the input events above clear map pins, so restore them
  }
  form.addEventListener('input', refresh);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validate()) { focusFirstError(form); return; }
    saveTrip(readTrip(form));
    window.location.href = 'booking.html';
  });

  updateFareHint(); initVideo();
  initCommon('.board__row:not(.board__head .board__row), .why__list li, .steps li, .fleet article, .faq details, .trust__item');
}

window.addEventListener('DOMContentLoaded', init);
