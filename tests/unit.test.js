import test from 'node:test';
import assert from 'node:assert/strict';
import { sydneyToUtc } from '../server/lib/time.js';
import { gstFromTotal, percentOf } from '../server/lib/money.js';
import { hashPassword, verifyPassword, signToken, verifyToken, newReference } from '../server/lib/crypto.js';
import { parseBookingInput, parseQuoteInput } from '../server/lib/validate.js';
import { resolveLocation, priceTrip, evaluatePromo } from '../server/services/pricing.js';
import { cancellationPolicy } from '../server/services/bookings.js';

test('Sydney local time converts to UTC across daylight saving', () => {
  assert.equal(sydneyToUtc('2030-01-10', '10:00').toISOString(), '2030-01-09T23:00:00.000Z'); // AEDT, UTC+11
  assert.equal(sydneyToUtc('2030-07-10', '10:00').toISOString(), '2030-07-10T00:00:00.000Z'); // AEST, UTC+10
  assert.equal(sydneyToUtc('2030-10-06', '12:00').toISOString(), '2030-10-06T01:00:00.000Z'); // after the October change
  assert.equal(sydneyToUtc('2030-02-31', '10:00'), null);
  assert.equal(sydneyToUtc('2030-01-10', '25:00'), null);
  assert.equal(sydneyToUtc('', ''), null);
});

test('GST is one eleventh of the total and percentages round to whole cents', () => {
  assert.equal(gstFromTotal(8500), 773);
  assert.equal(gstFromTotal(11000), 1000);
  assert.equal(percentOf(8500, 10), 850);
  assert.equal(percentOf(8501, 50), 4251);
});

test('passwords hash and verify, and tokens resist tampering and expiry', async () => {
  const h = await hashPassword('correct horse battery');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  assert.notEqual(await hashPassword('correct horse battery'), h); // random salt
  const t = signToken({ total: 8500 }, 'secret', 60);
  assert.equal(verifyToken(t, 'secret').total, 8500);
  assert.equal(verifyToken(t, 'other-secret'), null);
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ total: 1, exp: 9999999999 })).toString('base64url');
  assert.equal(verifyToken(`${forged}.${sig}`, 'secret'), null);
  assert.equal(verifyToken(signToken({ a: 1 }, 'secret', -5), 'secret'), null);
  assert.equal(body.length > 0, true);
  assert.match(newReference(), /^AT-[2-9A-HJKMNP-Z]{6}$/);
});

test('booking input reports each problem by field', () => {
  const { errors } = parseBookingInput({ pickup: 'x', destination: '', tripType: 'sideways', passengers: 0, customer: { name: 'A', email: 'nope', phone: '12' } });
  for (const f of ['destination', 'tripType', 'passengers', 'date', 'name', 'email', 'phone', 'vehicle', 'payment', 'terms', 'quoteToken', 'idempotencyKey']) assert.ok(errors[f], `expected an error for ${f}`);
  const ok = parseBookingInput({
    pickup: { label: 'Sydney CBD' }, destination: { label: 'Bondi Beach', lat: -33.89, lng: 151.27 }, tripType: 'return', date: '2030-01-10', time: '10:00', returnDate: '2030-01-12', returnTime: '09:00',
    passengers: '2', luggage: 1, vehicle: 'sedan', payment: 'card_online', termsAccepted: true, quoteToken: 'x.y', idempotencyKey: 'abcdefghijklmnop1234', customer: { name: 'Ann Lee', email: 'ann@example.com', phone: '0400 000 000' },
  });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.passengers, 2);
  assert.equal(parseQuoteInput({ pickup: 'a', destination: 'b', tripType: 'one_way', destination_lat: 1 }).errors.pickup, undefined);
  assert.ok(parseQuoteInput({ pickup: { label: 'a', lat: 10, lng: 10 }, destination: 'b', tripType: 'one_way' }).errors.pickup); // outside Australia
});

const DATA = {
  ruleSet: { id: 1, return_discount_percent: 10, child_seat_cents: 1000 },
  categories: [
    { id: 1, code: 'sedan', name: 'Sedan', example_model: '', passenger_capacity: 3, luggage_capacity: 3, features: [] },
    { id: 2, code: 'van', name: 'Van', example_model: '', passenger_capacity: 7, luggage_capacity: 8, features: [] },
  ],
  locations: [
    { id: 1, label: 'Sydney Airport (SYD) – International Terminal', kind: 'airport', lat: -33.9361, lng: 151.1637, radius_m: 900 },
    { id: 2, label: 'Bondi Beach', kind: 'area', lat: -33.8915, lng: 151.2767, radius_m: 1800 },
    { id: 3, label: 'Manly', kind: 'area', lat: -33.7969, lng: 151.2874, radius_m: 2000 },
  ],
  routes: [{ origin_id: 1, destination_id: 2, vehicle_category_id: 1, fare_cents: 9000 }, { origin_id: 1, destination_id: 2, vehicle_category_id: 2, fare_cents: 15000 }],
};
const trip = (o = {}) => ({ pickup: { label: 'Sydney Airport (SYD) – International Terminal', lat: null, lng: null }, destination: { label: 'bondi beach', lat: null, lng: null }, tripType: 'one_way', passengers: 1, luggage: 1, childSeats: 0, ...o });

test('places match by name (any case) or by a map pin inside the radius', () => {
  assert.equal(resolveLocation({ label: 'BONDI BEACH' }, DATA.locations).id, 2);
  assert.equal(resolveLocation({ label: '12 Campbell Pde, Bondi', lat: -33.8908, lng: 151.2743 }, DATA.locations).id, 2);
  assert.equal(resolveLocation({ label: 'Somewhere', lat: -33.7, lng: 150.7 }, DATA.locations), null);
  assert.equal(resolveLocation({ label: 'Somewhere else' }, DATA.locations), null);
});

test('fixed fares work in both directions, with return discount and child seats', () => {
  const one = priceTrip(trip(), DATA).results[0].quote;
  assert.equal(one.total, 9000); assert.equal(one.gst, 818);
  const back = priceTrip(trip({ pickup: { label: 'Bondi Beach' }, destination: { label: 'Sydney Airport (SYD) – International Terminal' } }), DATA).results[0].quote;
  assert.equal(back.total, 9000);
  const ret = priceTrip(trip({ tripType: 'return', childSeats: 2 }), DATA).results[0].quote;
  assert.deepEqual(ret.lines.map((l) => l.cents), [9000, 8100, 4000]); // 10% off the return leg, 2 seats x 2 legs x $10
  assert.equal(ret.total, 21100);
});

test('capacity, missing routes and promo codes', () => {
  const r = priceTrip(trip({ passengers: 5, luggage: 4 }), DATA).results;
  assert.equal(r[0].status, 'too_small'); assert.equal(r[1].status, 'ok');
  assert.equal(priceTrip(trip({ destination: { label: 'Manly' } }), DATA).anyPriced, false);
  assert.equal(priceTrip(trip({ destination: { label: 'Nowhere Street 5' } }), DATA).results[0].status, 'no_fixed_fare');
  const promo = { code: 'TEN', type: 'percent', value: 10, min_fare_cents: 0, max_uses: null, uses_count: 0, is_active: true };
  const q = priceTrip(trip(), DATA, promo).results[0].quote;
  assert.equal(q.discount, 900); assert.equal(q.total, 8100);
  assert.equal(evaluatePromo({ ...promo, valid_to: '2000-01-01T00:00:00Z' }, 9000).ok, false);
  assert.equal(evaluatePromo({ ...promo, max_uses: 3, uses_count: 3 }, 9000).ok, false);
  assert.equal(evaluatePromo({ ...promo, min_fare_cents: 20000 }, 9000).ok, false);
  assert.equal(evaluatePromo({ type: 'fixed', value: 99999, min_fare_cents: 0, is_active: true }, 9000).discount, 9000); // never below zero
});

test('cancellation is free until a leg is en route, then a percentage of the total', () => {
  const booking = { status: 'confirmed', quoted_total_cents: 10000 };
  assert.deepEqual(cancellationPolicy(booking, [{ leg_status: 'confirmed' }], 50), { allowed: true, feePercent: 0, feeCents: 0, reason: '' });
  const enRoute = cancellationPolicy(booking, [{ leg_status: 'en_route' }], 50);
  assert.equal(enRoute.allowed, true); assert.equal(enRoute.feeCents, 5000);
  assert.equal(cancellationPolicy(booking, [{ leg_status: 'in_progress' }], 50).allowed, false);
  assert.equal(cancellationPolicy({ ...booking, status: 'cancelled' }, [{ leg_status: 'cancelled' }], 50).allowed, false);
});
