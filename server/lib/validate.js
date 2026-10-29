// Small, explicit input validation. Every public endpoint parses its body through one of these,
// so nothing unchecked reaches the database. Errors are returned per field for the browser to show.
import { sydneyToUtc } from './time.js';

export class ApiError extends Error {
  constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields; }
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function text(value, { max = 200, min = 0 } = {}) {
  if (value === undefined || value === null) return min > 0 ? null : '';
  if (typeof value !== 'string') return null;
  const v = value.replace(/\s+/g, ' ').trim();
  if (CONTROL.test(v) || v.length > max || v.length < min) return null;
  return v;
}

/** Multi-line free text (notes, messages): keeps line breaks, strips control characters. */
export function paragraph(value, { max = 1000, min = 0 } = {}) {
  if (value === undefined || value === null) return min > 0 ? null : '';
  if (typeof value !== 'string') return null;
  const v = value.replace(/\r\n/g, '\n').trim();
  if (CONTROL.test(v) || v.length > max || v.length < min) return null;
  return v;
}

const int = (value, min, max) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

function place(value, field, errors) {
  const label = text(value?.label ?? (typeof value === 'string' ? value : undefined), { max: 200, min: 1 });
  if (!label) { errors[field] = 'Enter a place or address'; return null; }
  const lat = value?.lat; const lng = value?.lng;
  if (lat === undefined && lng === undefined) return { label, lat: null, lng: null };
  // Anywhere near Australia; stops nonsense coordinates reaching the database
  if (typeof lat !== 'number' || typeof lng !== 'number' || lat < -45 || lat > -9 || lng < 112 || lng > 154) {
    errors[field] = 'That map location is not valid'; return null;
  }
  return { label, lat, lng };
}

/** Fields shared by quotes and bookings. */
export function parseTrip(body, { requireWhen = false } = {}) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};
  const pickup = place(b.pickup, 'pickup', errors);
  const destination = place(b.destination, 'destination', errors);
  const tripType = b.tripType === 'return' ? 'return' : b.tripType === 'one_way' ? 'one_way' : null;
  if (!tripType) errors.tripType = 'Choose one way or return';
  const passengers = int(b.passengers ?? 1, 1, 20); if (passengers === null) errors.passengers = 'Passengers must be between 1 and 20';
  const luggage = int(b.luggage ?? 0, 0, 30); if (luggage === null) errors.luggage = 'Luggage must be between 0 and 30';
  const childSeats = int(b.childSeats ?? 0, 0, 6); if (childSeats === null) errors.childSeats = 'Child seats must be between 0 and 6';
  const promoCode = text(b.promoCode, { max: 40 }); if (promoCode === null) errors.promoCode = 'Check the promo code';

  let pickupAt = null; let returnAt = null;
  if (b.date || b.time || requireWhen) {
    pickupAt = sydneyToUtc(b.date, b.time);
    if (!pickupAt) errors.date = 'Choose a valid pickup date and time';
  }
  if (tripType === 'return' && (b.returnDate || b.returnTime || requireWhen)) {
    returnAt = sydneyToUtc(b.returnDate, b.returnTime);
    if (!returnAt) errors.returnDate = 'Choose a valid return date and time';
    else if (pickupAt && returnAt <= pickupAt) errors.returnDate = 'Return must be after the pickup';
  }
  return { errors, value: { pickup, destination, tripType, passengers, luggage, childSeats, promoCode: promoCode || '', pickupAt, returnAt } };
}

export function parseQuoteInput(body) {
  const { errors, value } = parseTrip(body);
  return { errors, value };
}

export const PAYMENT_PREFERENCES = ['card_online', 'deposit', 'cash_to_driver'];

export function parseBookingInput(body) {
  const { errors, value } = parseTrip(body, { requireWhen: true });
  const b = body && typeof body === 'object' ? body : {};
  const c = b.customer && typeof b.customer === 'object' ? b.customer : {};

  const fullName = text(c.name, { max: 120, min: 2 }); if (!fullName) errors.name = 'Enter your full name';
  const email = text(c.email, { max: 200, min: 3 }); if (!email || !EMAIL_RE.test(email)) errors.email = 'Check your email address';
  const phone = text(c.phone, { max: 30, min: 6 });
  if (!phone || !/^[+()\d][\d\s()+-]{5,}$/.test(phone) || phone.replace(/\D/g, '').length < 8) errors.phone = 'Check your phone number';
  const flight = text(b.flight, { max: 12 }); if (flight === null) errors.flight = 'Check the flight number';
  const notes = paragraph(b.notes, { max: 1000 }); if (notes === null) errors.notes = 'Notes are too long';
  const vehicle = text(b.vehicle, { max: 30, min: 1 }); if (!vehicle) errors.vehicle = 'Choose a vehicle';
  const payment = PAYMENT_PREFERENCES.includes(b.payment) ? b.payment : null; if (!payment) errors.payment = 'Choose how you would like to pay';
  if (b.termsAccepted !== true) errors.terms = 'Please agree to the terms to continue';
  const quoteToken = typeof b.quoteToken === 'string' ? b.quoteToken : ''; if (!quoteToken) errors.quoteToken = 'Please refresh your fare';
  const idempotencyKey = typeof b.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(b.idempotencyKey) ? b.idempotencyKey : null;
  if (!idempotencyKey) errors.idempotencyKey = 'Missing request key';

  return {
    errors,
    value: { ...value, vehicle, payment, quoteToken, idempotencyKey, flight: (flight || '').toUpperCase(), notes: notes || '', marketingOptIn: c.marketingOptIn === true, customer: { fullName, email, phone } },
    honeypot: typeof b.website === 'string' && b.website.trim() !== '',
  };
}

export function parseContactInput(body) {
  const errors = {};
  const b = body && typeof body === 'object' ? body : {};
  const name = text(b.name, { max: 120, min: 2 }); if (!name) errors.name = 'Enter your name';
  const email = text(b.email, { max: 200, min: 3 }); if (!email || !EMAIL_RE.test(email)) errors.email = 'Check your email address';
  const phone = text(b.phone, { max: 30 }); if (phone === null) errors.phone = 'Check your phone number';
  const message = paragraph(b.message, { max: 2000, min: 5 }); if (!message) errors.message = 'Tell us how we can help';
  const topic = ['general', 'quote', 'booking'].includes(b.topic) ? b.topic : 'general';
  let tripDetails = null;
  if (b.tripDetails && typeof b.tripDetails === 'object') {
    tripDetails = {};
    for (const k of ['from', 'to', 'when', 'party']) { const v = text(b.tripDetails[k], { max: 200 }); if (v) tripDetails[k] = v; }
    if (!Object.keys(tripDetails).length) tripDetails = null;
  }
  return { errors, value: { name, email, phone: phone || '', message, topic, tripDetails }, honeypot: typeof b.website === 'string' && b.website.trim() !== '' };
}

export function throwIfErrors(errors) {
  if (Object.keys(errors).length) throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.', errors);
}
