// Driving distance between two points, from OpenRouteService (free key at openrouteservice.org).
// Tests inject a fake with the same shape. With no key this module returns null and those trips need a manual quote.
import { distanceM } from './pricing.js';

export const SYDNEY = { lat: -33.8688, lng: 151.2093 };
// Sydney only: both ends of a trip must be within this distance of the CBD, and the drive must be a sane length.
export const SERVICE_RADIUS_M = 100_000;
export const MAX_ROUTE_M = 150_000;
export const inServiceArea = (lat, lng) => distanceM(lat, lng, SYDNEY.lat, SYDNEY.lng) <= SERVICE_RADIUS_M;

export function createRouting({ apiKey, fetchImpl = fetch, baseUrl = 'https://api.openrouteservice.org', log = console }) {
  if (!apiKey) return null;
  return {
    /** Driving distance and time. Throws on any provider problem; callers treat that as "no distance available". */
    async route(from, to) {
      const res = await fetchImpl(`${baseUrl}/v2/directions/driving-car`, {
        method: 'POST',
        headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }), // note: longitude first
        signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json().catch(() => ({}));
      const s = json?.routes?.[0]?.summary;
      if (!res.ok || !s || !Number.isFinite(s.distance) || s.distance <= 0) {
        log.error(`Routing lookup failed (${res.status}):`, json?.error?.message || json?.error || '');
        throw new Error('routing unavailable');
      }
      return { distanceM: Math.round(s.distance), durationS: Math.round(s.duration || 0) };
    },
  };
}
