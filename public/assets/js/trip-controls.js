// Controls shared by the homepage form and the booking page: suggestions, quick-pick chips,
// swap button, return-trip fields and the "remember this trip" behaviour.
import { localDate, icon } from './ui/ui.js';
import { openMapPicker } from './map-picker.js';

export const TRIP_FIELDS = ['tripType', 'pickup', 'destination', 'date', 'time', 'returnDate', 'returnTime', 'passengers', 'luggage', 'childSeats', 'flight'];

/** Fill the address suggestions with the places we sell fixed fares for (from the server). */
export function fillLocations(datalist, labels) {
  labels.forEach((l) => datalist.appendChild(Object.assign(document.createElement('option'), { value: l })));
}

export const tripType = (form) => form.querySelector('input[name="tripType"]:checked').value;

export function toggleReturn(form) {
  const isReturn = tripType(form) === 'return';
  form.querySelectorAll('[data-return-field]').forEach((f) => { f.hidden = !isReturn; });
}

/** Wire chips, swap and return toggle. onChange fires after any change made through these controls. */
export function initTripControls(form, onChange) {
  // "Set on map" button under the pickup and destination fields
  [['pickup', 'Set pickup on map'], ['destination', 'Set destination on map']].forEach(([name, title]) => {
    const input = form.elements[name]; if (!input) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'map-btn'; btn.append(icon('map-pin'), 'Set on map');
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', () => openMapPicker({ title, onPick: (label, lat, lng) => {
      input.value = label; input.dispatchEvent(new Event('input', { bubbles: true })); // typing clears any old pin...
      input.dataset.lat = String(lat); input.dataset.lng = String(lng);                // ...so set the new pin afterwards
      input.dispatchEvent(new Event('change', { bubbles: true })); input.scrollLeft = 0;
    } }));
    input.addEventListener('input', () => { delete input.dataset.lat; delete input.dataset.lng; });
    input.insertAdjacentElement('afterend', btn);
  });
  // Long place names: show the start of the text again once the field loses focus
  form.querySelectorAll('input[name="pickup"], input[name="destination"]').forEach((i) => i.addEventListener('blur', () => { i.scrollLeft = 0; }));
  const el = (name) => form.elements[name];

  form.querySelectorAll('[data-chips-for]').forEach((group) => {
    const input = el(group.dataset.chipsFor);
    const sync = () => group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.value === input.value)));
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      input.value = chip.dataset.value;
      input.dispatchEvent(new Event('input', { bubbles: true })); sync(); onChange();
    });
    input.addEventListener('input', sync); sync();
  });

  form.querySelectorAll('[data-date-chips]').forEach((group) => {
    const input = el('date');
    const sync = () => group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(input.value === localDate(Number(c.dataset.offset)))));
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      input.value = localDate(Number(chip.dataset.offset));
      input.dispatchEvent(new Event('input', { bubbles: true })); sync(); onChange();
    });
    input.addEventListener('input', sync); sync();
  });

  form.querySelectorAll('.swap').forEach((btn) => btn.addEventListener('click', () => {
    const a = el('pickup'); const b = el('destination');
    const pa = { lat: a.dataset.lat, lng: a.dataset.lng }; const pb = { lat: b.dataset.lat, lng: b.dataset.lng };
    [a.value, b.value] = [b.value, a.value];
    btn.classList.toggle('is-spinning');
    a.dispatchEvent(new Event('input', { bubbles: true })); b.dispatchEvent(new Event('input', { bubbles: true }));
    // typing clears map pins, so carry each pin over to the field its address moved to
    [[a, pb], [b, pa]].forEach(([input, pin]) => { if (pin.lat && pin.lng) { input.dataset.lat = pin.lat; input.dataset.lng = pin.lng; } });
    onChange();
  }));

  form.querySelectorAll('input[name="tripType"]').forEach((r) => r.addEventListener('change', () => { toggleReturn(form); onChange(); }));
  toggleReturn(form);

  const today = localDate();
  el('date').min = today; el('returnDate').min = today;
}

/** Read the trip fields from a form into a plain object (numbers for counts). */
export function readTrip(form) {
  const v = (n) => (form.elements[n] ? form.elements[n].value : '');
  const pin = (n) => { const i = form.elements[n]; const lat = i?.dataset.lat; const lng = i?.dataset.lng; return lat && lng ? [Number(lat), Number(lng)] : [null, null]; };
  const [pickupLat, pickupLng] = pin('pickup'); const [destinationLat, destinationLng] = pin('destination');
  return {
    pickupLat, pickupLng, destinationLat, destinationLng,
    tripType: tripType(form), pickup: v('pickup').trim(), destination: v('destination').trim(), date: v('date'), time: v('time'),
    returnDate: v('returnDate'), returnTime: v('returnTime'), passengers: Number(v('passengers') || 1),
    luggage: Number(v('luggage') || 0), childSeats: Number(v('childSeats') || 0), flight: v('flight').trim(),
  };
}

/** Write saved/URL trip values into a form. */
export function writeTrip(form, trip, setStepper) {
  const set = (n, val) => { if (val !== undefined && val !== null && val !== '' && form.elements[n]) form.elements[n].value = val; };
  ['pickup', 'destination', 'date', 'time', 'returnDate', 'returnTime', 'flight'].forEach((n) => set(n, trip[n]));
  [['pickup', trip.pickupLat, trip.pickupLng], ['destination', trip.destinationLat, trip.destinationLng]].forEach(([n, lat, lng]) => {
    const i = form.elements[n]; if (!i) return;
    if (typeof lat === 'number' && typeof lng === 'number') { i.dataset.lat = String(lat); i.dataset.lng = String(lng); } else { delete i.dataset.lat; delete i.dataset.lng; }
  });
  if (trip.tripType === 'return') { const r = form.querySelector('#tt-ret'); if (r) r.checked = true; }
  ['passengers', 'luggage', 'childSeats'].forEach((n) => {
    if (trip[n] === undefined || trip[n] === '' || !form.elements[n]) return;
    const stepper = form.elements[n].closest('[data-stepper]');
    if (stepper) setStepper(stepper, Number(trip[n]));
  });
  toggleReturn(form);
}
