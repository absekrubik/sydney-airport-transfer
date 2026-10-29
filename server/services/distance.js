// Looks up the driving distance for a trip that has no fixed fare, and remembers it so the price the customer
// saw is exactly the price re-checked when they book.
import { priceTrip, resolveLocation, distanceM } from './pricing.js';
import { inServiceArea, MAX_ROUTE_M } from './routing.js';

const pointOf = (place, data) => {
  if (place.lat != null && place.lng != null) return { lat: place.lat, lng: place.lng };
  const loc = resolveLocation(place, data.locations); // a known place name has coordinates too
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
};
const keyOf = (a, b) => `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

/**
 * Prices the trip. If some vehicle has no fixed fare and both ends have coordinates inside Sydney, adds the real
 * driving distance to `data` (data.distance) so priceTrip can use it. Never throws for routing problems:
 * the trip simply stays a manual quote.
 */
export async function attachDistance(db, routing, input, data, promo, now = new Date(), log = console) {
  data.distance = null;
  if (!data.ruleSet.distance_enabled || !data.rates.size) return data;
  const first = priceTrip(input, data, promo, now);
  const needs = first.results.some((r) => r.status === 'no_fixed_fare' && data.rates.has(data.categories.find((c) => c.code === r.category.code)?.id));
  if (!needs) return data;
  const a = pointOf(input.pickup, data); const b = pointOf(input.destination, data);
  if (!a || !b || !inServiceArea(a.lat, a.lng) || !inServiceArea(b.lat, b.lng)) return data;
  if (distanceM(a.lat, a.lng, b.lat, b.lng) < 300) return data; // same spot: nothing to price
  const key = keyOf(a, b);
  const cached = (await db.query("SELECT distance_m, duration_s FROM route_cache WHERE key = $1 AND created_at > now() - interval '90 days'", [key])).rows[0];
  let found = cached ? { distanceM: cached.distance_m, durationS: cached.duration_s } : null;
  if (!found && routing) {
    try {
      found = await routing.route(a, b);
      if (found.distanceM > 0 && found.distanceM <= MAX_ROUTE_M) {
        await db.query('INSERT INTO route_cache (key, distance_m, duration_s) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET distance_m = EXCLUDED.distance_m, duration_s = EXCLUDED.duration_s, created_at = now()', [key, found.distanceM, found.durationS]);
      }
    } catch (e) { log.error('Distance lookup failed:', e.message); found = null; }
  }
  if (found && found.distanceM > 0 && found.distanceM <= MAX_ROUTE_M) data.distance = found;
  return data;
}
