import { vehicleImage } from '../lib/images.js';
// Fare engine. A fixed fare wins. Otherwise, if a real driving distance is known (data.distance, looked up by
// distance.js) and the vehicle has distance rates, the fare is base + per-km with a minimum. With neither, the trip is "manual quote".
import { ApiError } from '../lib/validate.js';
import { gstFromTotal, percentOf } from '../lib/money.js';

export async function loadPricing(db) {
  const rs = await db.query('SELECT * FROM pricing_rule_sets WHERE is_active LIMIT 1');
  if (!rs.rows.length) throw new ApiError(503, 'NO_PRICING', 'Pricing is not set up yet. Please contact us for a quote.');
  const ruleSet = rs.rows[0];
  const [cats, locs, routes, rates] = await Promise.all([
    db.query('SELECT * FROM vehicle_categories WHERE is_active ORDER BY sort_order, id'),
    db.query('SELECT * FROM locations WHERE is_active ORDER BY sort_order, id'),
    db.query('SELECT * FROM fixed_routes WHERE rule_set_id = $1 AND is_active', [ruleSet.id]),
    db.query('SELECT * FROM distance_rates WHERE rule_set_id = $1', [ruleSet.id]),
  ]);
  return { ruleSet, categories: cats.rows, locations: locs.rows, routes: routes.rows, rates: new Map(rates.rows.map((r) => [r.vehicle_category_id, r])), distance: null };
}

const toRad = (d) => (d * Math.PI) / 180;
export function distanceM(lat1, lng1, lat2, lng2) {
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

/** A typed name matches a known location exactly; a map pin matches the nearest location whose radius contains it. */
export function resolveLocation(place, locations) {
  if (!place) return null;
  const label = place.label.trim().toLowerCase();
  const byName = locations.find((l) => l.label.toLowerCase() === label);
  if (byName) return byName;
  if (place.lat == null || place.lng == null) return null;
  let best = null; let bestD = Infinity;
  for (const l of locations) {
    const d = distanceM(place.lat, place.lng, l.lat, l.lng);
    if (d <= l.radius_m && d < bestD) { best = l; bestD = d; }
  }
  return best;
}

export function evaluatePromo(promo, subtotal, now = new Date()) {
  if (!promo || !promo.is_active) return { ok: false, message: 'That promo code is not valid.' };
  if (promo.valid_from && new Date(promo.valid_from) > now) return { ok: false, message: 'That promo code is not active yet.' };
  if (promo.valid_to && new Date(promo.valid_to) < now) return { ok: false, message: 'That promo code has expired.' };
  if (promo.max_uses != null && promo.uses_count >= promo.max_uses) return { ok: false, message: 'That promo code has been fully used.' };
  if (subtotal < promo.min_fare_cents) return { ok: false, message: 'This trip does not meet the minimum fare for that code.' };
  const raw = promo.type === 'percent' ? percentOf(subtotal, promo.value) : promo.value;
  return { ok: true, discount: Math.min(raw, subtotal), message: 'Promo code applied.' };
}

/** Fare for one leg by driving distance: base + per km, at least the minimum, rounded up to a whole dollar. */
export function distanceFare(rate, meters) {
  const km = Math.round(meters / 100) / 10; // 0.1 km steps
  const raw = Math.max(rate.min_cents, rate.base_cents + Math.round(rate.per_km_cents * km));
  return { cents: Math.ceil(raw / 100) * 100, km };
}

function findFare(routes, a, b, categoryId) {
  const r = routes.find((x) => x.vehicle_category_id === categoryId
    && ((x.origin_id === a && x.destination_id === b) || (x.origin_id === b && x.destination_id === a)));
  return r ? r.fare_cents : null;
}

/**
 * Price a trip for every vehicle category.
 * Order: fixed fare per leg -> return discount on leg 2 -> child seats (each way) -> promo -> GST portion.
 */
export function priceTrip(input, data, promo = null, now = new Date()) {
  const { ruleSet, categories, locations, routes } = data;
  const from = resolveLocation(input.pickup, locations);
  const to = resolveLocation(input.destination, locations);
  const sameAsPickup = from && to && from.id === to.id;

  const results = categories.map((category) => {
    const base = {
      category: { image: vehicleImage(category.code), code: category.code, name: category.name, example: category.example_model, passengers: category.passenger_capacity, luggage: category.luggage_capacity, features: category.features },
      quote: null,
    };
    if (category.passenger_capacity < input.passengers || category.luggage_capacity < input.luggage) return { ...base, status: 'too_small' };
    let fare = from && to && !sameAsPickup ? findFare(routes, from.id, to.id, category.id) : null;
    let method = 'fixed'; let km = null;
    const rate = data.rates?.get(category.id);
    if (fare == null && data.distance && ruleSet.distance_enabled && rate) {
      const d = distanceFare(rate, data.distance.distanceM); fare = d.cents; km = d.km; method = 'distance';
    }
    if (fare == null) return { ...base, status: 'no_fixed_fare' };

    const lines = [{ label: km ? `Outbound journey (${km} km)` : 'Outbound journey', cents: fare }];
    if (input.tripType === 'return') {
      const discount = ruleSet.return_discount_percent;
      lines.push({ label: `Return journey${km ? ` (${km} km)` : ''}${discount ? ` (${discount}% off)` : ''}`, cents: fare - percentOf(fare, discount) });
    }
    if (input.childSeats > 0) {
      const legs = input.tripType === 'return' ? 2 : 1;
      lines.push({ label: `Child seat × ${input.childSeats}${legs === 2 ? ' (both ways)' : ''}`, cents: input.childSeats * ruleSet.child_seat_cents * legs });
    }
    const subtotal = lines.reduce((s, l) => s + l.cents, 0);
    let discount = 0; let promoOutcome = null;
    if (promo) {
      promoOutcome = evaluatePromo(promo, subtotal, now);
      if (promoOutcome.ok) { discount = promoOutcome.discount; lines.push({ label: `Promo ${promo.code}`, cents: -discount }); }
    }
    const total = subtotal - discount;
    return { ...base, status: 'ok', method, promo: promoOutcome, quote: { lines, subtotal, discount, total, gst: gstFromTotal(total) } };
  });

  return { from, to, results, anyPriced: results.some((r) => r.status === 'ok') };
}
