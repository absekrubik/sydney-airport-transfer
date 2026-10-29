// Booking page: four guided steps (Trip, Vehicle, Your details, Review).
// Fares come from the server (POST /api/quotes); the booking is saved by POST /api/bookings.
// The server re-prices everything, so nothing the browser does can change what is charged.
import { setFieldError, focusFirstError, toast, formatMoney, icon, setVehicleImage, initSteppers, setStepper, loadTrip, saveTrip, localDate } from '../ui/ui.js';
import { api, tripBody, ApiError } from '../api.js';
import { fillLocations, initTripControls, readTrip, writeTrip } from '../trip-controls.js';
import { initCommon } from '../common.js';
import { roadLoader, pop } from '../motion.js';

const form = document.getElementById('booking-form');
const $ = (name) => form.elements[name];
const TOTAL_STEPS = 4;
const NEXT_LABEL = { 1: 'Choose a vehicle', 2: 'Add your details', 3: 'Review booking' };
let step = 1;
let maxStep = 1;
let quotes = null;          // last server response for the current trip
let quotesFor = '';         // the request that produced it, to know when it is stale
let quoteController = null;
let idempotencyKey = null;  // one key per submission attempt; a new one whenever the form changes
let submitting = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const selectedVehicleCode = () => form.querySelector('input[name="vehicle"]:checked')?.value || null;
const state = () => ({ ...readTrip(form), vehicleId: selectedVehicleCode() });
const result = () => quotes?.results.find((r) => r.category.code === selectedVehicleCode() && r.status === 'ok') || null;

// ---------- Formatting ----------
function niceDate(dateStr, timeStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  let text = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  if (timeStr) {
    const [h, min] = timeStr.split(':').map(Number);
    date.setHours(h, min);
    text += `, ${new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date)}`;
  }
  return text;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const party = (s) => `${plural(s.passengers, 'passenger')}, ${s.luggage === 0 ? 'no luggage' : plural(s.luggage, 'bag')}`;

// ---------- Fares from the server ----------
const requestBody = () => ({ ...tripBody(readTrip(form)), promoCode: $('promo').value.trim() });

async function fetchQuotes({ force = false } = {}) {
  const body = requestBody();
  const signature = JSON.stringify(body);
  if (!force && signature === quotesFor && quotes) return quotes;
  quoteController?.abort(); quoteController = new AbortController();
  try {
    const data = await api('POST', '/api/quotes', body, { signal: quoteController.signal });
    quotes = data; quotesFor = signature;
    const notice = document.getElementById('dev-notice');
    notice.hidden = !data.sample;
    if (data.sample) notice.textContent = 'Development preview: fares and vehicles are sample data, not real prices.';
    return data;
  } catch (e) {
    if (e.name === 'AbortError') return quotes;
    quotes = null; quotesFor = '';
    throw e;
  }
}

function renderPromoMessage() {
  const input = $('promo');
  let msg = document.getElementById('promo-msg');
  if (!msg) { msg = el('span', 'field__hint'); msg.id = 'promo-msg'; msg.setAttribute('aria-live', 'polite'); input.insertAdjacentElement('afterend', msg); }
  msg.textContent = input.value.trim() && quotes?.promo ? quotes.promo.message : '';
  msg.style.color = quotes?.promo && !quotes.promo.ok ? 'var(--danger)' : '';
}

let distancePricing = false;
// ---------- Vehicles ----------
async function renderVehicles() {
  const host = document.getElementById('vehicle-options');
  const note = document.getElementById('vehicle-note');
  const manual = document.getElementById('manual-quote');
  const s = state();
  const keep = s.vehicleId || form.dataset.wantedVehicle || '';
  host.replaceChildren(); manual.hidden = true;
  note.textContent = '';
  const loader = roadLoader('Checking fares…'); host.appendChild(loader);

  let data;
  try { data = await fetchQuotes(); } catch (e) {
    loader.remove(); note.textContent = '';
    host.appendChild(el('p', 'text-muted', e.message));
    const retry = el('button', 'btn btn--ghost btn--sm', 'Try again'); retry.type = 'button';
    retry.addEventListener('click', renderVehicles); host.appendChild(retry);
    return;
  }
  loader.remove();
  if (!data) return;
  note.textContent = `Fares for ${party(s)}${s.tripType === 'return' ? ', return trip' : ''}. GST included.${data.distance ? ` Priced by driving distance: about ${data.distance.km} km, ${data.distance.minutes} min each way.` : ''}`;

  data.results.forEach((r) => {
    const v = r.category;
    const label = el('label', 'vehicle-option');
    const radio = el('input');
    Object.assign(radio, { type: 'radio', name: 'vehicle', value: v.code, disabled: r.status !== 'ok', checked: r.status === 'ok' && v.code === keep });
    const thumb = el('img', 'vehicle-option__img');
    Object.assign(thumb, { alt: '', width: 110, height: 47, loading: 'lazy' });
    setVehicleImage(thumb, v);
    const info = el('div');
    info.append(el('div', 'vehicle-option__name', v.name), el('div', 'vehicle-option__meta', `${v.example ? `${v.example}. ` : ""}Up to ${v.passengers} passengers and ${v.luggage} bags.`));
    const price = el('div', 'vehicle-option__price');
    if (r.status === 'too_small') price.append('Too small', el('small', '', `Seats ${v.passengers}, ${v.luggage} bags`));
    else if (r.status === 'ok') price.append(formatMoney(r.quote.total), el('small', '', 'GST included'));
    else price.append('Quote needed', el('small', '', 'No fixed fare'));
    label.append(radio, thumb, info, price);
    host.appendChild(label);
  });

  // Nothing can be priced: offer a quote request with the trip details prefilled
  const anyOk = data.results.some((r) => r.status === 'ok');
  manual.hidden = anyOk;
  if (!anyOk) {
    const q = new URLSearchParams({ topic: 'quote', from: s.pickup, to: s.destination, when: niceDate(s.date, s.time), party: party(s) });
    document.getElementById('manual-quote-link').href = `contact.html?${q.toString()}`;
    if (distancePricing && !data.results.every((r) => r.status === 'too_small')) note.textContent = 'We could not price this trip instantly. Tip: use “Set on map” to choose exact pickup and drop-off points (within Sydney) to get a price straight away.';
    if (data.results.every((r) => r.status === 'too_small')) note.textContent = `No single vehicle fits ${party(s)}. Request a quote and we will arrange more than one vehicle.`;
  }
  host.querySelectorAll('input').forEach((r) => r.addEventListener('change', () => { document.getElementById('vehicle-error').textContent = ''; refreshAll(); }));
  renderPromoMessage();
  refreshAll();
}

// ---------- Summary, bar, review ----------
function addRow(dl, term, value) { dl.append(el('dt', '', term), el('dd', '', value || '—')); }

function renderSummary() {
  const s = state();
  const dl = document.getElementById('summary-details');
  const quoteHost = document.getElementById('summary-quote');
  dl.replaceChildren(); quoteHost.replaceChildren();

  if (!s.pickup && !s.destination) { quoteHost.append(el('p', 'summary-empty', 'Your trip and fare appear here as you fill in the form.')); return; }
  addRow(dl, 'Trip', s.tripType === 'return' ? 'Return' : 'One way');
  addRow(dl, 'From', s.pickup); addRow(dl, 'To', s.destination);
  addRow(dl, 'Pickup', niceDate(s.date, s.time));
  if (s.tripType === 'return') addRow(dl, 'Return', niceDate(s.returnDate, s.returnTime));
  addRow(dl, 'Party', party(s));
  const r = result();
  if (r) addRow(dl, 'Vehicle', r.category.name);

  if (!r) { quoteHost.append(el('p', 'summary-empty', 'Choose a vehicle to see your fare.')); return; }
  const ul = el('ul', 'quote-lines');
  r.quote.lines.forEach((l) => { const li = el('li'); li.append(el('span', '', l.label), el('span', '', formatMoney(l.cents))); ul.appendChild(li); });
  const total = el('div', 'quote-total'); total.append(el('span', '', 'Total'), el('span', '', formatMoney(r.quote.total)));
  quoteHost.append(ul, total, el('div', 'quote-gst', `Includes GST of ${formatMoney(r.quote.gst)}`));
}

function renderBar() {
  const totalHost = document.getElementById('bar-total');
  totalHost.replaceChildren();
  const r = result();
  if (r) totalHost.append('Total, GST included', el('strong', '', formatMoney(r.quote.total)));

  document.getElementById('back').hidden = step === 1;
  const next = document.getElementById('next');
  next.hidden = step === TOTAL_STEPS;
  next.replaceChildren(NEXT_LABEL[step] || '', icon('arrow-right'));
  const submit = document.getElementById('submit');
  submit.hidden = step !== TOTAL_STEPS;
  submit.disabled = submitting;
  submit.textContent = submitting ? 'Sending…' : 'Request booking';
}

function renderReview() {
  const s = state();
  const dl = document.getElementById('review');
  dl.replaceChildren();
  const row = (term, value, goto) => {
    const dd = el('dd'); dd.append(value || '—');
    if (goto) { const b = el('button', 'change', 'Change'); b.type = 'button'; b.dataset.goto = String(goto); b.setAttribute('aria-label', `Change ${term.toLowerCase()}`); dd.append(b); }
    dl.append(el('dt', '', term), dd);
  };
  row('Trip', s.tripType === 'return' ? 'Return' : 'One way', 1);
  row('From', s.pickup); row('To', s.destination);
  row('Pickup', niceDate(s.date, s.time));
  if (s.tripType === 'return') row('Return', niceDate(s.returnDate, s.returnTime));
  row('Party', party(s));
  if (s.childSeats) row('Child seats', String(s.childSeats));
  if (s.flight) row('Flight', s.flight.toUpperCase());
  const r = result();
  row('Vehicle', r?.category.name, 2);
  row('Name', $('name').value.trim(), 3); row('Phone', $('phone').value.trim()); row('Email', $('email').value.trim());
  if (r) row('Total', `${formatMoney(r.quote.total)} (GST ${formatMoney(r.quote.gst)})`);
}

function refreshAll() { renderSummary(); renderBar(); }

// ---------- Validation (the server checks everything again; this just saves a round trip) ----------
function validateStep(n) {
  let ok = true;
  const need = (name, msg) => { if (!$(name).value.trim()) { setFieldError($(name), msg); ok = false; return false; } return true; };
  if (n === 1) {
    const s = state();
    ['pickup', 'destination', 'date', 'time', 'returnDate', 'returnTime'].forEach((x) => setFieldError($(x), ''));
    need('pickup', 'Enter where we pick you up'); need('destination', 'Enter where you are going');
    if (s.pickup && s.pickup.toLowerCase() === s.destination.toLowerCase()) { setFieldError($('destination'), 'Destination must be different from pickup'); ok = false; }
    if (need('date', 'Choose a date') && s.date < localDate()) { setFieldError($('date'), 'That date has passed'); ok = false; }
    need('time', 'Choose a time');
    if (s.tripType === 'return') {
      need('returnDate', 'Choose a return date'); need('returnTime', 'Choose a return time');
      if (s.returnDate && s.date && `${s.returnDate}T${s.returnTime || '00:00'}` <= `${s.date}T${s.time || '00:00'}`) { setFieldError($('returnDate'), 'Return must be after pickup'); ok = false; }
    }
  }
  if (n === 2) {
    const err = document.getElementById('vehicle-error');
    err.textContent = '';
    if (!selectedVehicleCode()) {
      err.textContent = document.getElementById('manual-quote').hidden ? 'Choose a vehicle to continue' : 'This trip needs a quote. Use the button below to request one.';
      ok = false;
    }
  }
  if (n === 3) {
    ['name', 'phone', 'email'].forEach((x) => setFieldError($(x), ''));
    need('name', 'Enter your full name');
    if (need('phone', 'Enter a mobile number where we can reach you') && $('phone').value.replace(/\D/g, '').length < 8) { setFieldError($('phone'), 'Check your phone number'); ok = false; }
    if (need('email', 'Enter your email')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('email').value.trim())) { setFieldError($('email'), 'Check your email address'); ok = false; }
    }
  }
  if (n === 4) {
    const terms = document.getElementById('terms');
    setFieldError(terms, '');
    if (!terms.checked) { setFieldError(terms, 'Please agree to continue'); ok = false; }
  }
  return ok;
}

// ---------- Step navigation ----------
async function showStep(n, { focus = true } = {}) {
  form.dataset.dir = n < step ? 'back' : 'fwd';
  const previous = step;
  step = n; maxStep = Math.max(maxStep, n);
  form.querySelectorAll('.step').forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  document.querySelectorAll('.progress li').forEach((li, i) => {
    const num = i + 1;
    const done = num < n || (num <= maxStep && num !== n);
    li.classList.toggle('is-current', num === n);
    li.classList.toggle('is-done', done);
    const btn = li.querySelector('.progress__btn');
    if (num === n) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
    const numEl = btn.querySelector('.progress__num');
    numEl.replaceChildren(done ? icon('check') : String(num));
    if (num === n && n !== previous) pop(numEl);
    const svg = numEl.querySelector('svg'); if (svg) { svg.style.width = '14px'; svg.style.height = '14px'; }
  });
  if (n === 2) renderVehicles();
  if (n === 4) renderReview();
  refreshAll();
  if (focus) {
    document.getElementById(`h-${n}`).focus({ preventScroll: true });
    document.querySelector('.progress').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function goNext() {
  if (!validateStep(step)) { focusFirstError(form); return; }
  if (step === 3) { // pick up a promo code change before the review shows a total
    try { await fetchQuotes(); } catch { /* the submit step reports connection problems */ }
    if (!result() && selectedVehicleCode()) { await showStep(2); toast('Please choose your vehicle again.', 'info'); return; }
  }
  if (step < TOTAL_STEPS) showStep(step + 1);
}

function persist() {
  const { vehicleId, ...trip } = state();
  saveTrip({ ...trip, vehicleId }); // trip details only: never name, email or phone
}

// ---------- Submitting ----------
const FIELD_STEP = { pickup: 1, destination: 1, date: 1, time: 1, returnDate: 1, tripType: 1, passengers: 1, luggage: 1, childSeats: 1, flight: 1,
  vehicle: 2, quoteToken: 2, name: 3, email: 3, phone: 3, notes: 3, promoCode: 3, payment: 4, terms: 4 };
const FIELD_INPUT = { terms: 'terms', promoCode: 'promo', returnDate: 'returnDate' };

function showServerErrors(fields) {
  let first = null;
  for (const [name, message] of Object.entries(fields)) {
    if (name === 'vehicle' || name === 'quoteToken') { document.getElementById('vehicle-error').textContent = message; first ??= name; continue; }
    const input = form.elements[FIELD_INPUT[name] || name] || document.getElementById(FIELD_INPUT[name] || name);
    if (input) { setFieldError(input, message); first ??= name; }
  }
  if (first) {
    const target = FIELD_STEP[first] || step;
    if (target !== step) showStep(target, { focus: false });
    focusFirstError(form);
  }
}

async function submit() {
  if (submitting) return;
  for (let n = 1; n <= 3; n += 1) { // re-check every earlier step so nothing slips through
    if (!validateStep(n)) { await showStep(n); focusFirstError(form); toast('Please fix the highlighted field.', 'error'); return; }
  }
  if (!validateStep(4)) { focusFirstError(form); return; }
  const r = result();
  if (!r) { await showStep(2); toast('Please choose your vehicle again.', 'info'); return; }

  idempotencyKey ??= crypto.randomUUID().replaceAll('-', '');
  submitting = true; renderBar();
  try {
    const t = readTrip(form);
    const out = await api('POST', '/api/bookings', {
      ...requestBody(), flight: t.flight, notes: $('notes').value.trim(), vehicle: r.category.code, quoteToken: r.token,
      payment: form.querySelector('input[name="payment"]:checked').value, termsAccepted: document.getElementById('terms').checked,
      idempotencyKey, website: $('website').value,
      customer: { name: $('name').value.trim(), email: $('email').value.trim(), phone: $('phone').value.trim() },
    });
    try { sessionStorage.removeItem('skyline.trip'); } catch { /* storage unavailable */ }
    window.location.href = `confirmation.html?ref=${encodeURIComponent(out.reference)}&t=${encodeURIComponent(out.viewToken)}`;
  } catch (e) {
    submitting = false; renderBar();
    if (e instanceof ApiError && ['PRICE_CHANGED', 'QUOTE_EXPIRED'].includes(e.code)) {
      idempotencyKey = null; quotesFor = '';
      await showStep(2); toast(e.message, 'info');
    } else if (e instanceof ApiError && e.code === 'MANUAL_QUOTE') {
      await showStep(2); toast(e.message, 'error');
    } else if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) {
      idempotencyKey = null; showServerErrors(e.fields); toast(e.message, 'error');
    } else toast(e.message || 'We could not send your booking. Please try again.', 'error');
  }
}

// Show only the payment options the business has switched on (and card options only when Stripe is set up)
async function applyPaymentOptions() {
  try {
    const c = await api('GET', '/api/config/public');
    const allowed = { card_online: c.payments.card_online && c.stripeReady, deposit: c.payments.deposit && c.stripeReady, cash_to_driver: c.payments.cash_to_driver };
    if (!Object.values(allowed).some(Boolean)) allowed.cash_to_driver = true; // never leave the customer with nothing to pick
    let firstOn = null;
    form.querySelectorAll('input[name="payment"]').forEach((i) => {
      const on = Boolean(allowed[i.value]);
      i.closest('.pay-option').hidden = !on;
      if (on && !firstOn) firstOn = i;
    });
    const checked = form.querySelector('input[name="payment"]:checked');
    if ((!checked || checked.closest('.pay-option').hidden) && firstOn) firstOn.checked = true;
    distancePricing = Boolean(c.distancePricing);
    const t = form.querySelector('[data-deposit-text]');
    if (t) t.textContent = `Pay a ${c.deposit.percent}% deposit by card now and the balance to your driver.`;
  } catch { /* leave all options visible; the server still checks */ }
}

async function init() {
  applyPaymentOptions();
  api('GET', '/api/locations').then(({ locations }) => fillLocations(document.getElementById('locations'), locations.map((l) => l.label))).catch(() => {});
  initSteppers(form, () => onTripChange());
  initTripControls(form, () => onTripChange());

  // Prefill order: link parameters first, then whatever this tab remembers
  const p = new URLSearchParams(window.location.search);
  const fromUrl = {};
  ['pickup', 'destination', 'date', 'time', 'returnDate', 'returnTime', 'tripType', 'passengers', 'luggage', 'childSeats', 'flight'].forEach((k) => { if (p.get(k)) fromUrl[k] = p.get(k); });
  const trip = { ...loadTrip(), ...fromUrl };
  if (fromUrl.pickup || fromUrl.destination) ['pickupLat', 'pickupLng', 'destinationLat', 'destinationLng'].forEach((k) => delete trip[k]); // link text replaces any remembered pin
  writeTrip(form, trip, setStepper);
  ['pickup', 'destination', 'date'].forEach((n) => $(n).dispatchEvent(new Event('input')));
  writeTrip(form, trip, setStepper); // typing clears map pins, so restore them
  form.dataset.wantedVehicle = p.get('vehicle') || trip.vehicleId || '';

  form.addEventListener('input', (e) => { idempotencyKey = null; if (e.target.name === 'promo') quotesFor = ''; onTripChange(); });
  $('promo').addEventListener('change', async () => { quotesFor = ''; try { await fetchQuotes(); } catch { /* shown on the vehicle step */ } renderPromoMessage(); refreshAll(); });
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON' || e.target.type === 'checkbox') return;
    e.preventDefault();
    if (step < TOTAL_STEPS) goNext();
  });
  document.getElementById('next').addEventListener('click', goNext);
  document.getElementById('back').addEventListener('click', () => showStep(step - 1));
  document.querySelector('.progress').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-goto]'); if (!btn) return;
    const n = Number(btn.dataset.goto);
    if (n < step || (n <= maxStep && n !== step)) showStep(n);
  });
  form.addEventListener('click', (e) => { const c = e.target.closest('.change'); if (c) showStep(Number(c.dataset.goto)); });
  form.addEventListener('submit', (e) => { e.preventDefault(); if (step !== TOTAL_STEPS) goNext(); else submit(); });

  await showStep(1, { focus: false });
  initCommon();
}

function onTripChange() {
  persist();
  if (step === 2) renderVehicles();
  refreshAll();
}

window.addEventListener('DOMContentLoaded', init);
