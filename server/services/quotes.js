import { loadPricing, priceTrip } from './pricing.js';
import { signToken, verifyToken } from '../lib/crypto.js';
import { ApiError } from '../lib/validate.js';
import { attachDistance } from './distance.js';

const QUOTE_TTL_SECONDS = 15 * 60;

export async function findPromo(db, code) {
  if (!code) return null;
  const { rows } = await db.query('SELECT * FROM promotions WHERE lower(code) = lower($1)', [code]);
  return rows[0] || null;
}

function tokenPayload(input, data, priced, result, promo) {
  return { rs: data.ruleSet.id, cat: result.category.code, a: priced.from?.id ?? 0, b: priced.to?.id ?? 0, m: result.method, dm: result.method === 'distance' ? data.distance.distanceM : 0, tt: input.tripType, cs: input.childSeats, pid: promo && result.promo?.ok ? promo.id : null, total: result.quote.total };
}

/** POST /api/quotes: itemised fare per vehicle category, each with a signed token the booking must present. */
export async function createQuotes(db, config, input, { routing = null, log = console } = {}) {
  const data = await loadPricing(db);
  const promo = await findPromo(db, input.promoCode);
  await attachDistance(db, routing, input, data, promo, new Date(), log);
  const priced = priceTrip(input, data, promo);
  const results = priced.results.map((r) => (r.status === 'ok'
    ? { ...r, token: signToken(tokenPayload(input, data, priced, r, promo), config.secret, QUOTE_TTL_SECONDS) }
    : r));
  const firstPromo = results.find((r) => r.promo)?.promo;
  return {
    sample: data.ruleSet.is_sample,
    rulesVersion: data.ruleSet.version_number,
    pickup: { label: input.pickup.label, area: priced.from?.label || null },
    destination: { label: input.destination.label, area: priced.to?.label || null },
    manualQuote: !priced.anyPriced,
    distance: data.distance ? { km: Math.round(data.distance.distanceM / 100) / 10, minutes: Math.round(data.distance.durationS / 60) } : null,
    promo: input.promoCode ? { code: input.promoCode, ok: Boolean(firstPromo?.ok), message: firstPromo ? firstPromo.message : (promo ? 'Choose a vehicle to apply this code.' : 'That promo code is not valid.') } : null,
    results,
  };
}

/** Re-price on the server and check it matches what the customer was shown. */
export function verifyQuote(config, data, input, promo, vehicleCode, token, now = new Date()) {
  const payload = verifyToken(token, config.secret);
  if (!payload) throw new ApiError(409, 'QUOTE_EXPIRED', 'Your fare has expired. Please check the price again.');
  const priced = priceTrip(input, data, promo, now);
  const result = priced.results.find((r) => r.category.code === vehicleCode);
  if (!result) throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.', { vehicle: 'Choose a vehicle' });
  if (result.status === 'too_small') throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.', { vehicle: 'That vehicle is too small for your group' });
  if (result.status !== 'ok') throw new ApiError(422, 'MANUAL_QUOTE', 'This trip needs a manual quote. Please contact us.');
  const expected = tokenPayload(input, data, priced, result, promo);
  const same = ['rs', 'cat', 'a', 'b', 'm', 'dm', 'tt', 'cs', 'pid', 'total'].every((k) => payload[k] === expected[k]);
  if (!same) throw new ApiError(409, 'PRICE_CHANGED', 'The fare has changed since you last checked. Please review the new price.');
  return { priced, result };
}
