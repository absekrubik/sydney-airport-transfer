// Client-side fare PREVIEW for Stage 2 (sample data only).
// In Stage 3 the server's POST /api/quotes becomes the source of truth and
// this file will call it instead. The server will always recalculate on submit.
import { findFixedFare, DEV_RULES, VEHICLES } from './mock-data.js';

/** A vehicle fits a party only if it has enough seats AND luggage room. */
export function vehicleFits(vehicle, passengers, luggage) {
  return vehicle.passengers >= passengers && vehicle.luggage >= luggage;
}

/**
 * Build an itemised quote for one vehicle.
 * Returns { ok: false, reason } when no fixed route matches. We deliberately do
 * NOT invent a distance-based price here: real distance needs the maps provider.
 */
export function buildQuote({ pickup, destination, tripType, childSeats, vehicleId }) {
  const legFare = findFixedFare(pickup, destination, vehicleId);
  if (legFare == null) {
    return { ok: false, reason: 'manual-quote' };
  }

  const lines = [{ label: 'Outbound journey', cents: legFare }];

  if (tripType === 'return') {
    // Return-trip rule: percentage discount on the second leg (configurable in admin later).
    const returnFare = Math.round(legFare * (1 - DEV_RULES.returnDiscountPercent / 100));
    lines.push({ label: `Return journey (${DEV_RULES.returnDiscountPercent}% off)`, cents: returnFare });
  }

  const seats = Number(childSeats) || 0;
  if (seats > 0) {
    const legs = tripType === 'return' ? 2 : 1;
    lines.push({ label: `Child seat × ${seats}${legs === 2 ? ' (both ways)' : ''}`, cents: seats * DEV_RULES.childSeatCents * legs });
  }

  const total = lines.reduce((sum, l) => sum + l.cents, 0);
  // Prices are GST-inclusive in Australia: GST portion is one eleventh of the total.
  const gst = Math.round(total / 11);
  return { ok: true, lines, total, gst };
}

/**
 * Lowest fare among vehicles that fit the party. Used for the "From $X" hint on the homepage.
 * Returns { state: 'ok', quote, vehicle } | { state: 'no-fixed-fare' } | { state: 'too-big' }.
 */
export function cheapestQuote(trip) {
  const fitting = VEHICLES.filter((v) => vehicleFits(v, trip.passengers, trip.luggage));
  if (!fitting.length) return { state: 'too-big' };
  const quotes = fitting.map((v) => ({ vehicle: v, quote: buildQuote({ ...trip, vehicleId: v.id }) })).filter((q) => q.quote.ok);
  if (!quotes.length) return { state: 'no-fixed-fare' };
  quotes.sort((a, b) => a.quote.total - b.quote.total);
  return { state: 'ok', ...quotes[0] };
}
