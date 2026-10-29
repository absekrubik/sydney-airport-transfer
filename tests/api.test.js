// End-to-end tests: real HTTP requests -> app -> real PostgreSQL.
// Run with TEST_PSQL_ARGS or TEST_DATABASE_URL set (see tests/helpers/setup.js).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { freshDb, dbAvailable, CONFIG } from './helpers/setup.js';
import { createUser } from '../server/services/auth.js';
import { sydneyToUtc } from '../server/lib/time.js';
import crypto from 'node:crypto';
import { ApiError } from '../server/lib/validate.js';
import { distanceM, distanceFare } from '../server/services/pricing.js';

const skip = dbAvailable() ? false : 'set TEST_PSQL_ARGS or TEST_DATABASE_URL to run database tests';
let db; let server; let base; let offsetMs = 0;
// A stand-in for Stripe so tests never touch the network
const fake = {
  mode: 'test', n: 0, sessions: new Map(), refunds: [], failRefunds: false,
  async createCheckoutSession(params) { const id = `cs_test_${++fake.n}`; const sess = { id, url: `https://checkout.stripe.test/${id}`, params, payment_status: 'unpaid', amount_total: params.line_items[0].price_data.unit_amount, metadata: params.metadata, payment_intent: `pi_${id}` }; fake.sessions.set(id, sess); return sess; },
  async retrieveSession(id) { return fake.sessions.get(id); },
  async expireSession(id) { const x = fake.sessions.get(id); if (x) x.expired = true; return x; },
  async createRefund(params) { if (fake.failRefunds) throw new ApiError(502, 'PAYMENT_PROVIDER', 'Stripe is down'); const r = { id: `re_${++fake.n}`, status: 'succeeded', ...params }; fake.refunds.push(r); return r; },
};
const WHSEC = 'whsec_test_secret';
// A stand-in for the routing service: off by default so older tests behave as before
const fakeRoute = { on: false, calls: 0, async route(a, b) { fakeRoute.calls += 1; if (!fakeRoute.on) throw new Error('down'); return { distanceM: Math.round(distanceM(a.lat, a.lng, b.lat, b.lng) * 1.3), durationS: 1800 }; } };
const clock = () => new Date(Date.now() + offsetMs);
const AIRPORT = 'Sydney Airport (SYD) – International Terminal';

const sydneyDate = (daysAhead) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() + daysAhead * 86400000));

async function call(method, path, { body, cookie, csrf, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.clone().json(); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers };
}

const baseTrip = (o = {}) => ({ pickup: { label: AIRPORT }, destination: { label: 'Sydney CBD' }, tripType: 'one_way', date: sydneyDate(10), time: '10:00', passengers: 2, luggage: 2, childSeats: 0, ...o });

async function book(o = {}, { vehicle = 'sedan', key = `k${Math.random().toString(36).slice(2)}${Date.now()}abcdef` } = {}) {
  const trip = baseTrip(o.trip);
  const q = await call('POST', '/api/quotes', { body: trip });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const result = q.json.results.find((r) => r.category.code === vehicle);
  const payload = { ...trip, vehicle, quoteToken: result.token, payment: 'card_online', termsAccepted: true, idempotencyKey: key, customer: { name: 'Ann Lee', email: 'ann@example.com', phone: '0400 000 000' }, ...o.extra };
  return { res: await call('POST', '/api/bookings', { body: payload }), payload, quote: q.json };
}

before(async () => {
  if (skip) return;
  db = await freshDb();
  CONFIG.allowPrivateImageFetch = true; // tests download from a local server
  CONFIG.vehicleImageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vehicle-img-'));
  CONFIG.stripeWebhookSecret = WHSEC; CONFIG.publicUrl = 'https://example.test';
  const app = createApp({ db, config: CONFIG, now: clock, log: { error() {} }, stripe: fake, routing: fakeRoute });
  server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await createUser(db, { email: 'owner@example.com', fullName: 'Test Owner', role: 'owner', password: 'a long test passphrase' });
  await db.query("INSERT INTO promotions (code, type, value) VALUES ('TEN', 'percent', 10)");
});
after(async () => { if (skip) return; await new Promise((r) => server.close(r)); await db.end(); });

test('public data endpoints return the seeded configuration and say it is sample data', { skip }, async () => {
  const v = await call('GET', '/api/vehicle-categories');
  assert.equal(v.json.vehicles.length, 4);
  const r = await call('GET', '/api/routes');
  assert.equal(r.json.sample, true);
  assert.ok(r.json.routes.some((x) => x.to === 'Bondi Beach' && x.fromCents === 9000 && x.fares.sedan === 9000 && x.fares.van === 15000));
  const c = await call('GET', '/api/config/public');
  assert.equal(c.json.cancellation.feePercent, 50);
  const l = await call('GET', '/api/locations');
  assert.ok(l.json.locations.length >= 9);
});

test('security headers are set and only the website folders are served', { skip }, async () => {
  const page = await fetch(`${base}/public/index.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  for (const p of ['/server/app.js', '/package.json', '/.env', '/public/../server/config.js', '/public/%2e%2e/server/config.js', '/docs/stage-1-plan.md', '/tests/api.test.js']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(`${base}/public/assets/css/tokens.css`)).status, 200);
});

test('quotes: fixed fare, GST, return discount, child seats, map pins, promo and manual quote', { skip }, async () => {
  const one = (await call('POST', '/api/quotes', { body: baseTrip() })).json;
  const sedan = one.results.find((r) => r.category.code === 'sedan');
  assert.equal(sedan.quote.total, 8500); assert.equal(sedan.quote.gst, 773);
  assert.equal(one.sample, true); assert.equal(one.manualQuote, false);

  const ret = (await call('POST', '/api/quotes', { body: baseTrip({ tripType: 'return', childSeats: 1, returnDate: sydneyDate(12), returnTime: '09:00' }) })).json;
  assert.deepEqual(ret.results[0].quote.lines.map((l) => l.cents), [8500, 7650, 2000]);

  const pin = (await call('POST', '/api/quotes', { body: baseTrip({ destination: { label: '5 Campbell Pde, Bondi Beach NSW', lat: -33.8908, lng: 151.2743 } }) })).json;
  assert.equal(pin.destination.area, 'Bondi Beach');
  assert.equal(pin.results[0].quote.total, 9000);

  const promo = (await call('POST', '/api/quotes', { body: baseTrip({ promoCode: 'ten' }) })).json;
  assert.equal(promo.results[0].quote.total, 7650); assert.equal(promo.promo.ok, true);
  const bad = (await call('POST', '/api/quotes', { body: baseTrip({ promoCode: 'NOPE' }) })).json;
  assert.equal(bad.promo.ok, false); assert.equal(bad.results[0].quote.total, 8500);

  const manual = (await call('POST', '/api/quotes', { body: baseTrip({ destination: { label: 'Penrith' } }) })).json;
  assert.equal(manual.manualQuote, true); assert.ok(manual.results.every((r) => r.quote === null));
  const big = (await call('POST', '/api/quotes', { body: baseTrip({ passengers: 9 }) })).json;
  assert.ok(big.results.every((r) => r.status === 'too_small'));

  const bad2 = await call('POST', '/api/quotes', { body: { pickup: '', destination: 'x', tripType: 'nope' } });
  assert.equal(bad2.status, 400); assert.ok(bad2.json.error.fields.pickup);
});

test('booking: saved in one transaction, viewable only with its link, customer reused by email', { skip }, async () => {
  const { res, payload } = await book({ trip: { tripType: 'return', returnDate: sydneyDate(12), returnTime: '09:00', childSeats: 1 }, extra: { flight: 'qf401', notes: 'Please meet at arrivals' } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const { reference, viewToken } = res.json;
  assert.match(reference, /^AT-/);

  const legs = (await db.query('SELECT * FROM booking_legs ORDER BY leg_number', [])).rows.filter((l) => true);
  const mine = (await db.query('SELECT l.* FROM booking_legs l JOIN bookings b ON b.id = l.booking_id WHERE b.reference = $1 ORDER BY leg_number', [reference])).rows;
  assert.equal(mine.length, 2);
  assert.equal(mine[0].pickup_address, AIRPORT); assert.equal(mine[1].pickup_address, 'Sydney CBD'); // return leg is reversed
  assert.equal(new Date(mine[0].pickup_at).toISOString(), sydneyToUtc(payload.date, '10:00').toISOString());
  const hist = (await db.query('SELECT to_status FROM booking_status_history h JOIN bookings b ON b.id = h.booking_id WHERE b.reference = $1', [reference])).rows;
  assert.deepEqual(hist.map((h) => h.to_status), ['pending']);
  assert.ok(legs.length >= 2);

  const view = await call('GET', `/api/bookings/${reference}?t=${viewToken}`);
  assert.equal(view.status, 200);
  assert.equal(view.json.status, 'pending'); assert.equal(view.json.flight, 'QF401');
  assert.equal(view.json.quote.total, 8500 + 7650 + 2000); assert.equal(view.json.legs.length, 2);
  assert.equal(view.json.cancellation.feeCents, 0);
  assert.ok(!('notes_internal' in view.json) && !JSON.stringify(view.json).includes('ann@example.com'));
  assert.equal((await call('GET', `/api/bookings/${reference}?t=wrong-token`)).status, 404);
  assert.equal((await call('GET', `/api/bookings/${reference}`)).status, 404);
  assert.equal((await call('GET', `/api/bookings/AT-ZZZZZZ?t=${viewToken}`)).status, 404);

  await book({ extra: { customer: { name: 'Ann B Lee', email: 'ANN@example.com', phone: '0411 111 111' } } });
  const customers = (await db.query("SELECT * FROM customers WHERE lower(email) = 'ann@example.com'", [])).rows;
  assert.equal(customers.length, 1); assert.equal(customers[0].full_name, 'Ann B Lee');
});

test('booking: idempotent retry returns the same booking and never double-books', { skip }, async () => {
  const key = 'idem-key-1234567890abcd';
  const a = await book({}, { key });
  const b = await call('POST', '/api/bookings', { body: a.payload });
  assert.equal(a.res.status, 201); assert.equal(b.status, 200);
  assert.equal(b.json.reference, a.res.json.reference);
  const n = (await db.query('SELECT count(*)::int AS n FROM bookings WHERE idempotency_key = $1', [key])).rows[0].n;
  assert.equal(n, 1);
});

test('booking: refuses tampered, expired or changed prices and bad input', { skip }, async () => {
  const { payload } = await book();
  const fresh = { ...payload, idempotencyKey: `fresh${Date.now()}abcdefghijkl` };
  // changing what was quoted (a child seat adds cost) must not reuse the old price
  const changed = await call('POST', '/api/bookings', { body: { ...fresh, childSeats: 2 } });
  assert.equal(changed.status, 409); assert.equal(changed.json.error.code, 'PRICE_CHANGED');
  const swapped = await call('POST', '/api/bookings', { body: { ...fresh, vehicle: 'luxury' } });
  assert.equal(swapped.status, 409); // token was for the sedan
  const forged = await call('POST', '/api/bookings', { body: { ...fresh, quoteToken: `${payload.quoteToken.split('.')[0]}.AAAA` } });
  assert.equal(forged.status, 409); assert.equal(forged.json.error.code, 'QUOTE_EXPIRED');
  const soon = await book({ trip: { date: sydneyDate(0), time: '00:01' } });
  assert.equal(soon.res.status, 400); assert.ok(soon.res.json.error.fields.date);
  const noTerms = await call('POST', '/api/bookings', { body: { ...fresh, termsAccepted: false, customer: { name: 'A', email: 'bad', phone: '1' } } });
  assert.equal(noTerms.status, 400); assert.ok(noTerms.json.error.fields.email && noTerms.json.error.fields.terms && noTerms.json.error.fields.name);
  const manual = await call('POST', '/api/bookings', { body: { ...fresh, destination: { label: 'Penrith' } } }); // a sedan token reused on an unpriced trip
  assert.equal(manual.status, 422); assert.equal(manual.json.error.code, 'MANUAL_QUOTE');
  const noToken = await book({ trip: { destination: { label: 'Penrith' } } }); // no token exists for a trip that cannot be priced
  assert.equal(noToken.res.status, 400); assert.ok(noToken.res.json.error.fields.quoteToken);
  const before = (await db.query('SELECT count(*)::int AS n FROM bookings', [])).rows[0].n;
  const bot = await call('POST', '/api/bookings', { body: { ...fresh, website: 'http://spam.example' } });
  assert.equal(bot.status, 202);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM bookings', [])).rows[0].n, before);
});

test('booking: promo use is counted and a vehicle that is too small is refused', { skip }, async () => {
  const { res } = await book({ trip: { promoCode: 'TEN' } });
  assert.equal(res.status, 201);
  const b = (await db.query('SELECT quoted_total_cents, discount_cents FROM bookings WHERE reference = $1', [res.json.reference])).rows[0];
  assert.equal(b.quoted_total_cents, 7650); assert.equal(b.discount_cents, 850);
  assert.equal((await db.query("SELECT uses_count FROM promotions WHERE code = 'TEN'", [])).rows[0].uses_count, 1);

  const q = (await call('POST', '/api/quotes', { body: baseTrip() })).json;
  const tok = q.results.find((r) => r.category.code === 'sedan').token;
  const crowded = await call('POST', '/api/bookings', { body: { ...baseTrip({ passengers: 6 }), vehicle: 'sedan', quoteToken: tok, payment: 'card_online', termsAccepted: true, idempotencyKey: `crowd${Date.now()}abcdefghijkl`, customer: { name: 'Ann Lee', email: 'ann@example.com', phone: '0400 000 000' } } });
  assert.equal(crowded.status, 400); assert.ok(crowded.json.error.fields.vehicle);
});

test('customer cancellation is free before en route and charges the set percentage after', { skip }, async () => {
  const a = await book();
  const { reference, viewToken } = a.res.json;
  const done = await call('POST', `/api/bookings/${reference}/cancel`, { body: { t: viewToken } });
  assert.equal(done.status, 200); assert.equal(done.json.feeCents, 0);
  assert.equal((await call('GET', `/api/bookings/${reference}?t=${viewToken}`)).json.status, 'cancelled');
  assert.equal((await call('POST', `/api/bookings/${reference}/cancel`, { body: { t: viewToken } })).status, 409); // already cancelled
  assert.equal((await call('POST', `/api/bookings/${reference}/cancel`, { body: { t: 'nope' } })).status, 404);

  const b = await book();
  const ref2 = b.res.json.reference; const tok2 = b.res.json.viewToken;
  await db.query("UPDATE bookings SET status = 'confirmed' WHERE reference = $1", [ref2]);
  await db.query("UPDATE booking_legs SET leg_status = 'en_route' WHERE booking_id = (SELECT id FROM bookings WHERE reference = $1)", [ref2]);
  const preview = await call('GET', `/api/bookings/${ref2}?t=${tok2}`);
  assert.equal(preview.json.cancellation.feeCents, 4250); assert.equal(preview.json.cancellation.feePercent, 50);
  const refused = await call('POST', `/api/bookings/${ref2}/cancel`, { body: { t: tok2 } });
  assert.equal(refused.status, 409); assert.equal(refused.json.error.code, 'FEE_NOT_ACCEPTED');
  const ok = await call('POST', `/api/bookings/${ref2}/cancel`, { body: { t: tok2, acceptFee: true } });
  assert.equal(ok.status, 200); assert.equal(ok.json.feeCents, 4250);
  assert.equal((await db.query('SELECT cancellation_fee_cents FROM bookings WHERE reference = $1', [ref2])).rows[0].cancellation_fee_cents, 4250);

  const c = await book();
  await db.query("UPDATE booking_legs SET leg_status = 'in_progress' WHERE booking_id = (SELECT id FROM bookings WHERE reference = $1)", [c.res.json.reference]);
  assert.equal((await call('POST', `/api/bookings/${c.res.json.reference}/cancel`, { body: { t: c.res.json.viewToken, acceptFee: true } })).status, 409);
});

test('contact form saves a message and quote-request details; bots are ignored', { skip }, async () => {
  const ok = await call('POST', '/api/contact', { body: { name: 'Sam', email: 'sam@example.com', topic: 'quote', message: 'Quote for Penrith please', tripDetails: { from: 'Sydney Airport', to: 'Penrith' } } });
  assert.equal(ok.status, 201);
  assert.equal((await db.query("SELECT trip_details->>'to' AS t FROM contact_messages WHERE email = 'sam@example.com'", [])).rows[0].t, 'Penrith');
  assert.equal((await call('POST', '/api/contact', { body: { name: '', email: 'x', message: '' } })).status, 400);
  assert.equal((await call('POST', '/api/contact', { body: { name: 'Bot', email: 'b@example.com', message: 'hello there', website: 'x' } })).status, 202);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM contact_messages WHERE email = 'b@example.com'", [])).rows[0].n, 0);
});

test('cross-site posts and non-JSON bodies are refused', { skip }, async () => {
  const x = await call('POST', '/api/quotes', { body: baseTrip(), headers: { Origin: 'https://evil.example' } });
  assert.equal(x.status, 403);
  const res = await fetch(`${base}/api/quotes`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hi' });
  assert.equal(res.status, 415);
  const big = await fetch(`${base}/api/quotes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(70000) }) });
  assert.equal(big.status, 413);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('DELETE', '/api/quotes')).status, 405);
});

test('admin: login, sessions, csrf, lockout, password change', { skip }, async () => {
  assert.equal((await call('GET', '/api/admin/dashboard/stats')).status, 401);
  assert.equal((await call('GET', '/api/admin/bookings')).status, 401);

  const wrong = await call('POST', '/api/admin/auth/login', { body: { email: 'owner@example.com', password: 'wrong password!!' } });
  const ghost = await call('POST', '/api/admin/auth/login', { body: { email: 'nobody@example.com', password: 'wrong password!!' } });
  assert.equal(wrong.status, 401); assert.deepEqual(wrong.json, ghost.json); // cannot tell which emails exist

  const login = await call('POST', '/api/admin/auth/login', { body: { email: 'OWNER@example.com', password: 'a long test passphrase' } });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/);
  const cookie = setCookie.split(';')[0]; const csrf = login.json.csrfToken;
  assert.ok(!JSON.stringify(login.json).includes('password'));
  const stored = (await db.query('SELECT token_hash FROM sessions', [])).rows;
  assert.ok(stored.every((s) => !cookie.includes(s.token_hash)) && stored.length >= 1); // only a hash is stored

  const me = await call('GET', '/api/admin/auth/me', { cookie });
  assert.equal(me.json.user.role, 'owner'); assert.equal(me.json.csrfToken, csrf);

  const stats = (await call('GET', '/api/admin/dashboard/stats', { cookie })).json;
  assert.ok(stats.totalBookings >= 5 && stats.pendingBookings >= 1);
  assert.equal(stats.recordedRevenue, 0); // no money has moved yet
  const list = (await call('GET', '/api/admin/bookings?status=pending&q=Ann', { cookie })).json;
  assert.ok(list.total >= 1 && list.bookings[0].customer_name.startsWith('Ann'));
  assert.equal((await call('GET', '/api/admin/bookings?status=bogus', { cookie })).status, 400);
  const detail = (await call('GET', `/api/admin/bookings/${list.bookings[0].id}`, { cookie })).json;
  assert.equal(detail.booking.customer_email.toLowerCase(), 'ann@example.com');
  assert.ok(!('view_token_hash' in detail.booking));
  assert.equal((await call('GET', '/api/admin/bookings/abc', { cookie })).status, 404);

  assert.equal((await call('POST', '/api/admin/auth/change-password', { cookie, body: { currentPassword: 'a long test passphrase', newPassword: 'another long passphrase' } })).status, 403); // no csrf header
  assert.equal((await call('POST', '/api/admin/auth/change-password', { cookie, csrf, body: { currentPassword: 'wrong', newPassword: 'another long passphrase' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/auth/change-password', { cookie, csrf, body: { currentPassword: 'a long test passphrase', newPassword: 'short' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/auth/change-password', { cookie, csrf, body: { currentPassword: 'a long test passphrase', newPassword: 'another long passphrase' } })).status, 200);

  assert.equal((await call('POST', '/api/admin/auth/logout', { cookie })).status, 403);
  const out = await call('POST', '/api/admin/auth/logout', { cookie, csrf });
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call('GET', '/api/admin/auth/me', { cookie })).status, 401);
  assert.ok((await db.query("SELECT count(*)::int AS n FROM audit_log WHERE action IN ('login','logout','change_password')", [])).rows[0].n >= 3);
});

test('admin: account locks after repeated failures, staff role limits, idle sessions expire', { skip }, async () => {
  await createUser(db, { email: 'lock@example.com', fullName: 'Lock Test', role: 'staff', password: 'staff test passphrase' });
  for (let i = 0; i < 5; i += 1) assert.equal((await call('POST', '/api/admin/auth/login', { body: { email: 'lock@example.com', password: 'bad bad bad bad' } })).status, 401);
  const locked = await call('POST', '/api/admin/auth/login', { body: { email: 'lock@example.com', password: 'staff test passphrase' } });
  assert.equal(locked.status, 429); assert.equal(locked.json.error.code, 'LOCKED'); // even the right password is refused while locked
  offsetMs = 16 * 60 * 1000; // 16 minutes later
  const again = await call('POST', '/api/admin/auth/login', { body: { email: 'lock@example.com', password: 'staff test passphrase' } });
  assert.equal(again.status, 200);
  const cookie = again.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/admin/auth/me', { cookie })).status, 200);
  offsetMs += 3 * 3600 * 1000; // 3 hours idle
  assert.equal((await call('GET', '/api/admin/auth/me', { cookie })).status, 401);
  offsetMs = 0;
});

test('rate limits slow down floods of bookings, contact messages and logins', { skip }, async () => {
  const app = createApp({ db, config: { ...CONFIG, rateLimitScale: 1 }, now: clock, log: { error() {} } });
  const s = http.createServer(app.handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}`;
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const codes = [];
  for (let i = 0; i < 7; i += 1) codes.push((await post('/api/contact', { name: 'Flood', email: 'f@example.com', message: 'hello there' })).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429, 429]);
  const retry = await post('/api/contact', { name: 'Flood', email: 'f@example.com', message: 'hello there' });
  assert.equal(retry.headers.get('retry-after'), '60');
  await new Promise((r) => s.close(r));
});

test('admin: vehicle photos can be uploaded, replaced and removed, with strict checks', { skip }, async () => {
  const raw = async (method, url, { cookie, csrf, body, type } = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(type ? { 'Content-Type': type } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body });
    let json = null; try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json };
  };
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);
  assert.equal((await call('GET', '/api/admin/vehicles')).status, 401);
  assert.equal((await raw('PUT', '/api/admin/vehicles/sedan/image', { type: 'image/jpeg', body: jpeg })).status, 401);

  const login = await call('POST', '/api/admin/auth/login', { body: { email: 'owner@example.com', password: 'another long passphrase' } });
  const cookie = login.headers.get('set-cookie').split(';')[0]; const csrf = login.json.csrfToken;
  const list = (await call('GET', '/api/admin/vehicles', { cookie })).json.vehicles;
  assert.equal(list.length, 4); assert.ok(list.every((v) => v.image.photo === false));

  assert.equal((await raw('PUT', '/api/admin/vehicles/sedan/image', { cookie, type: 'image/jpeg', body: jpeg })).status, 403); // no csrf
  assert.equal((await raw('PUT', '/api/admin/vehicles/nope/image', { cookie, csrf, type: 'image/jpeg', body: jpeg })).status, 404);
  const fake = await raw('PUT', '/api/admin/vehicles/sedan/image', { cookie, csrf, type: 'image/jpeg', body: Buffer.from('<script>alert(1)</script>'.repeat(20)) });
  assert.equal(fake.status, 415);
  assert.equal((await raw('PUT', '/api/admin/vehicles/sedan/image', { cookie, csrf, type: 'image/jpeg', body: Buffer.alloc(3 * 1024 * 1024 + 10, 0xff) })).status, 413);
  assert.equal((await raw('PUT', '/api/admin/vehicles/sedan/image', { cookie, csrf, type: 'image/jpeg', body: Buffer.alloc(0) })).status, 400);

  const ok = await raw('PUT', '/api/admin/vehicles/sedan/image', { cookie, csrf, type: 'image/jpeg', body: jpeg });
  assert.equal(ok.status, 200); assert.equal(ok.json.image.photo, true); assert.match(ok.json.image.url, /sedan\.jpg\?v=\d+$/);
  assert.ok(fs.existsSync(path.join(CONFIG.vehicleImageDir, 'sedan.jpg')));
  const pub = (await call('GET', '/api/vehicle-categories')).json.vehicles;
  assert.equal(pub.find((v) => v.code === 'sedan').image.photo, true);
  assert.equal(pub.find((v) => v.code === 'suv').image.photo, false);

  const replaced = await raw('PUT', '/api/admin/vehicles/sedan/image', { cookie, csrf, type: 'image/png', body: png });
  assert.match(replaced.json.image.url, /sedan\.png/);
  assert.ok(!fs.existsSync(path.join(CONFIG.vehicleImageDir, 'sedan.jpg'))); // the old file does not linger

  assert.equal((await call('DELETE', '/api/admin/vehicles/sedan/image', { cookie })).status, 403); // no csrf
  const gone = await call('DELETE', '/api/admin/vehicles/sedan/image', { cookie, csrf });
  assert.equal(gone.status, 200); assert.equal(gone.json.image.photo, false);
  assert.equal(fs.readdirSync(CONFIG.vehicleImageDir).length, 0);
  const trail = await db.query("SELECT action FROM audit_log WHERE action LIKE 'vehicle_image%' ORDER BY id");
  assert.deepEqual(trail.rows.map((r) => r.action), ['vehicle_image_upload', 'vehicle_image_upload', 'vehicle_image_remove']);
});

test('admin: a vehicle photo can be fetched from a web address, with unsafe addresses refused', { skip }, async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
  const img = http.createServer((req, res) => {
    if (req.url === '/photo.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(jpeg); }
    else if (req.url === '/redirect') { res.writeHead(302, { Location: '/photo.jpg' }); res.end(); }
    else if (req.url === '/page') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>not an image</html>'.repeat(30)); }
    else if (req.url === '/huge') { res.writeHead(200); res.end(Buffer.alloc(3 * 1024 * 1024 + 50, 0xff)); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => img.listen(0, '127.0.0.1', r));
  const src = `http://127.0.0.1:${img.address().port}`;
  try {
    const login = await call('POST', '/api/admin/auth/login', { body: { email: 'owner@example.com', password: 'another long passphrase' } });
    const cookie = login.headers.get('set-cookie').split(';')[0]; const csrf = login.json.csrfToken;
    const go = (url, code = 'van') => call('POST', `/api/admin/vehicles/${code}/image-from-url`, { cookie, csrf, body: { url } });
    assert.equal((await call('POST', '/api/admin/vehicles/van/image-from-url', { body: { url: `${src}/photo.jpg` } })).status, 401);
    assert.equal((await call('POST', '/api/admin/vehicles/van/image-from-url', { cookie, body: { url: `${src}/photo.jpg` } })).status, 403);
    assert.equal((await go('not a link')).status, 400);
    assert.equal((await go(`${src}/page`)).status, 415);
    assert.equal((await go(`${src}/huge`)).status, 413);
    assert.equal((await go(`${src}/missing`)).status, 400);
    assert.equal((await go(`${src}/photo.jpg`, 'nope')).status, 404);
    const ok = await go(`${src}/redirect`);
    assert.equal(ok.status, 200); assert.equal(ok.json.image.photo, true);
    assert.ok(fs.existsSync(path.join(CONFIG.vehicleImageDir, 'van.jpg')));
    // with the test allowance off, private addresses and plain http are refused
    CONFIG.allowPrivateImageFetch = false;
    for (const u of [`${src}/photo.jpg`, 'https://127.0.0.1/x.jpg', 'https://localhost/x.jpg', 'https://169.254.169.254/latest/meta-data', 'http://example.com/x.jpg', 'ftp://example.com/x.jpg']) {
      assert.equal((await go(u)).status, 400, u);
    }
  } finally {
    CONFIG.allowPrivateImageFetch = true;
    await call('DELETE', '/api/admin/vehicles/van/image', { cookie: (await call('POST', '/api/admin/auth/login', { body: { email: 'owner@example.com', password: 'another long passphrase' } })).headers.get('set-cookie').split(';')[0], csrf: 'x' });
    await new Promise((r) => img.close(r));
  }
});

test('admin: vehicles can be added, edited, hidden and deleted', { skip }, async () => {
  const login = await call('POST', '/api/admin/auth/login', { body: { email: 'owner@example.com', password: 'another long passphrase' } });
  const cookie = login.headers.get('set-cookie').split(';')[0]; const csrf = login.json.csrfToken;
  const body = { name: 'Mercedes V-Class', example: 'V-Class or similar', passengers: 6, luggage: 6, features: ['Wi-Fi', 'Water'], copyFaresFrom: 'van', farePercent: 120 };
  assert.equal((await call('POST', '/api/admin/vehicles', { body })).status, 401);
  assert.equal((await call('POST', '/api/admin/vehicles', { cookie, body })).status, 403);
  const bad = await call('POST', '/api/admin/vehicles', { cookie, csrf, body: { name: '', passengers: 0, luggage: -1 } });
  assert.equal(bad.status, 400); assert.ok(bad.json.error.fields.name && bad.json.error.fields.passengers && bad.json.error.fields.luggage);
  const made = await call('POST', '/api/admin/vehicles', { cookie, csrf, body });
  assert.equal(made.status, 201); assert.equal(made.json.vehicle.code, 'mercedes-v-class'); assert.ok(made.json.faresCopied > 0);
  assert.equal((await call('POST', '/api/admin/vehicles', { cookie, csrf, body: { ...body, copyFaresFrom: undefined } })).json.vehicle.code, 'mercedes-v-class-2');
  // live on the public site with a plain-car image until a photo is added, and priced from the copied fares
  const pub = (await call('GET', '/api/vehicle-categories')).json.vehicles.find((c) => c.code === 'mercedes-v-class');
  assert.ok(pub); assert.equal(pub.image.photo, false); assert.match(pub.image.url, /generic\.svg$/);
  const edited = await call('PATCH', '/api/admin/vehicles/mercedes-v-class', { cookie, csrf, body: { name: 'Mercedes V-Class Luxury', passengers: 7 } });
  assert.equal(edited.status, 200); assert.equal(edited.json.vehicle.passengers, 7);
  assert.equal((await call('PATCH', '/api/admin/vehicles/nope', { cookie, csrf, body: { name: 'X Y' } })).status, 404);
  assert.equal((await call('PATCH', '/api/admin/vehicles/mercedes-v-class', { cookie, csrf, body: { active: false } })).status, 200);
  assert.ok(!(await call('GET', '/api/vehicle-categories')).json.vehicles.some((c) => c.code === 'mercedes-v-class'));
  const all = (await call('GET', '/api/admin/vehicles', { cookie })).json.vehicles;
  assert.equal(all.find((v) => v.code === 'mercedes-v-class').active, false);
  assert.equal((await call('DELETE', '/api/admin/vehicles/mercedes-v-class', { cookie, csrf })).status, 200);
  assert.equal((await call('DELETE', '/api/admin/vehicles/mercedes-v-class-2', { cookie, csrf })).status, 200);
  assert.equal((await call('DELETE', '/api/admin/vehicles/mercedes-v-class', { cookie, csrf })).status, 404);
});

async function ownerSession() {
  const login = await call('POST', '/api/admin/auth/login', { body: { email: 'owner@example.com', password: 'another long passphrase' } });
  return { cookie: login.headers.get('set-cookie').split(';')[0], csrf: login.json.csrfToken };
}

test('admin: drivers, assigning a trip, moving it through its stages, and the cancellation fee rule', { skip }, async () => {
  const s = await ownerSession();
  const post = (p, body) => call('POST', p, { ...s, body });
  assert.equal((await call('POST', '/api/admin/drivers', { body: { fullName: 'Sam Driver', phone: '0411 111 111' } })).status, 401);
  const bad = await post('/api/admin/drivers', { fullName: '', phone: 'abc' });
  assert.equal(bad.status, 400); assert.ok(bad.json.error.fields.fullName && bad.json.error.fields.phone);
  const d1 = (await post('/api/admin/drivers', { fullName: 'Sam Driver', phone: '0411 111 111', vehicleCode: 'sedan', vehicleDetails: 'White Camry' })).json.driver;
  const d2 = (await post('/api/admin/drivers', { fullName: 'Pat Second', phone: '0422 222 222' })).json.driver;
  assert.equal(d1.vehicleName, 'Business Sedan');
  assert.equal((await post('/api/admin/drivers', { fullName: 'X Y', phone: '0411 111 111', vehicleCode: 'nope' })).status, 400);

  const { res } = await book({}, { vehicle: 'sedan' });
  const id = (await call('GET', '/api/admin/bookings?q=' + res.json.reference, s)).json.bookings[0].id;
  const legStatus = (leg, status) => post(`/api/admin/bookings/${id}/legs/${leg}/status`, { status });
  // a pending booking cannot have trips moved along, and must be confirmed first
  assert.equal((await legStatus(1, 'en_route')).status, 409);
  assert.equal((await post(`/api/admin/bookings/${id}/status`, { status: 'completed' })).status, 409);
  assert.equal((await post(`/api/admin/bookings/${id}/status`, { status: 'bogus' })).status, 400);
  assert.equal((await post(`/api/admin/bookings/${id}/status`, { status: 'confirmed' })).status, 200);
  assert.equal((await post(`/api/admin/bookings/${id}/status`, { status: 'confirmed' })).status, 409);
  assert.equal((await call('GET', `/api/admin/bookings/${id}`, s)).json.legs[0].leg_status, 'confirmed');
  // needs a driver before "on the way"
  assert.equal((await legStatus(1, 'en_route')).json.error.code, 'NO_DRIVER');
  assert.equal((await post(`/api/admin/bookings/${id}/legs/1/driver`, { driverId: d1.id })).status, 200);
  assert.equal((await post(`/api/admin/bookings/${id}/legs/9/driver`, { driverId: d1.id })).status, 404);
  assert.equal((await post(`/api/admin/bookings/${id}/legs/1/driver`, { driverId: 99999 })).status, 404);
  // the same driver on another trip at the same time is flagged, and allowed only when forced
  const second = await book({}, { vehicle: 'sedan' });
  const id2 = (await call('GET', '/api/admin/bookings?q=' + second.res.json.reference, s)).json.bookings[0].id;
  await post(`/api/admin/bookings/${id2}/status`, { status: 'confirmed' });
  const busy = await post(`/api/admin/bookings/${id2}/legs/1/driver`, { driverId: d1.id });
  assert.equal(busy.status, 409); assert.equal(busy.json.error.code, 'DRIVER_BUSY');
  assert.equal((await post(`/api/admin/bookings/${id2}/legs/1/driver`, { driverId: d1.id, force: true })).status, 200);
  assert.equal((await post(`/api/admin/bookings/${id2}/legs/1/driver`, { driverId: d2.id })).status, 200);
  // an assigned driver cannot be deleted; an inactive one cannot be assigned
  assert.equal((await call('DELETE', `/api/admin/drivers/${d1.id}`, s)).status, 409);
  assert.equal((await call('PATCH', `/api/admin/drivers/${d2.id}`, { ...s, body: { active: false } })).status, 200);
  assert.equal((await post(`/api/admin/bookings/${id}/legs/1/driver`, { driverId: d2.id })).json.error.code, 'DRIVER_INACTIVE');
  // stages happen in order
  assert.equal((await legStatus(1, 'completed')).status, 409);
  assert.equal((await legStatus(1, 'en_route')).status, 200);
  // customer now pays the cancellation fee because the driver is on the way
  const view = await call('GET', `/api/bookings/${res.json.reference}?t=${res.json.viewToken}`);
  assert.ok(view.json.cancellation.feeCents > 0, JSON.stringify(view.json.cancellation));
  assert.equal((await legStatus(1, 'in_progress')).status, 200);
  const done = await legStatus(1, 'completed');
  assert.equal(done.json.bookingStatus, 'completed');
  assert.equal((await post(`/api/admin/bookings/${id}/legs/1/driver`, { driverId: d1.id })).json.error.code, 'CLOSED');
  const detail = (await call('GET', `/api/admin/bookings/${id}`, s)).json;
  assert.equal(detail.legs[0].driver_name, 'Sam Driver'); assert.ok(detail.history.length >= 4);
  // decline cancels the trips; internal notes are saved
  assert.equal((await post(`/api/admin/bookings/${id2}/status`, { status: 'cancelled', reason: 'Customer called' })).status, 200);
  assert.equal((await call('GET', `/api/admin/bookings/${id2}`, s)).json.legs[0].leg_status, 'cancelled');
  assert.equal((await call('PUT', `/api/admin/bookings/${id2}/notes`, { ...s, body: { notes: 'Called at 9am' } })).status, 200);
  assert.equal((await call('GET', `/api/admin/bookings/${id2}`, s)).json.booking.notes_internal, 'Called at 9am');
  assert.equal((await call('DELETE', `/api/admin/drivers/${d2.id}`, s)).status, 409);
});

test('admin: pricing is owner-only, versioned, validated, and changes new quotes but not old bookings', { skip }, async () => {
  const s = await ownerSession();
  assert.equal((await call('GET', '/api/admin/pricing')).status, 401);
  await createUser(db, { email: 'staff@example.com', fullName: 'Staff', role: 'staff', password: 'staff long passphrase' });
  const sl = await call('POST', '/api/admin/auth/login', { body: { email: 'staff@example.com', password: 'staff long passphrase' } });
  const staff = { cookie: sl.headers.get('set-cookie').split(';')[0], csrf: sl.json.csrfToken };
  assert.equal((await call('GET', '/api/admin/pricing', staff)).status, 403);
  assert.equal((await call('PUT', '/api/admin/pricing', { ...staff, body: { childSeatCents: 1000 } })).status, 403);

  const before = (await call('GET', '/api/admin/pricing', s)).json;
  const route = before.routes.find((r) => r.from === AIRPORT && r.to === 'Sydney CBD');
  const oldBooking = await book({}, { vehicle: 'sedan' });
  const put = (body) => call('PUT', '/api/admin/pricing', { ...s, body });
  assert.equal((await put({ returnDiscountPercent: 150 })).status, 400);
  assert.equal((await put({ cancellationPercent: -1 })).status, 400);
  assert.equal((await put({ fares: [{ fromId: route.fromId, toId: route.toId, vehicle: 'sedan', cents: 5 }] })).status, 400);
  assert.equal((await put({ fares: [{ fromId: route.fromId, toId: route.toId, vehicle: 'nope', cents: 9000 }] })).status, 400);
  const ok = await put({ returnDiscountPercent: 20, childSeatCents: 1500, cancellationPercent: 30, fares: [{ fromId: route.fromId, toId: route.toId, vehicle: 'sedan', cents: 12300 }] });
  assert.equal(ok.status, 200); assert.equal(ok.json.version, before.version + 1);
  assert.equal(ok.json.pricing.isSample, false); assert.equal(ok.json.pricing.cancellationPercent, 30);
  assert.equal(ok.json.pricing.fares[`${route.key}|sedan`], 12300);
  // other fares carry over untouched
  assert.equal(ok.json.pricing.fares[`${route.key}|suv`], before.fares[`${route.key}|suv`]);
  const q = (await call('POST', '/api/quotes', { body: baseTrip() })).json.results.find((r) => r.category.code === 'sedan');
  assert.equal(q.quote.total, 12300);
  // removing a fare turns the route into "quote on request"
  assert.equal((await put({ fares: [{ fromId: route.fromId, toId: route.toId, vehicle: 'sedan', cents: null }] })).status, 200);
  assert.equal((await call('POST', '/api/quotes', { body: baseTrip() })).json.results.find((r) => r.category.code === 'sedan').status, 'no_fixed_fare');
  // the earlier booking still shows the price it was sold at
  const refView = await call('GET', `/api/admin/bookings?q=${oldBooking.res.json.reference}`, s);
  assert.ok(refView.json.bookings[0].quoted_total_cents > 0);
  assert.notEqual(refView.json.bookings[0].quoted_total_cents, 12300);
});

test('admin: promo codes can be created, validated, used by quotes, switched off and deleted', { skip }, async () => {
  const s = await ownerSession();
  const post = (p, body) => call('POST', p, { ...s, body });
  assert.equal((await call('GET', '/api/admin/promotions')).status, 401);
  const bad = await post('/api/admin/promotions', { code: 'a b', type: 'percent', value: 150 });
  assert.equal(bad.status, 400); assert.ok(bad.json.error.fields.code && bad.json.error.fields.value);
  assert.equal((await post('/api/admin/promotions', { code: 'FLAT', type: 'fixed', value: 50 })).status, 400); // under $1
  assert.equal((await post('/api/admin/promotions', { code: 'LATE', type: 'percent', value: 10, validFrom: '2030-02-01', validTo: '2030-01-01' })).status, 400);
  const made = await post('/api/admin/promotions', { code: 'summer15', type: 'percent', value: 15, maxUses: 5, validFrom: '2020-01-01', validTo: '2099-12-31' });
  assert.equal(made.status, 201); assert.equal(made.json.promotion.code, 'SUMMER15');
  assert.equal((await post('/api/admin/promotions', { code: 'SUMMER15', type: 'percent', value: 5 })).status, 409);
  const fixed = (await post('/api/admin/promotions', { code: 'TENOFF', type: 'fixed', value: 1000 })).json.promotion;
  assert.equal(fixed.value, 1000);
  // a new code works in a quote straight away
  const qj = (await call('POST', '/api/quotes', { body: baseTrip({ promoCode: 'summer15' }) })).json;
  assert.equal(qj.promo.ok, true); assert.ok(qj.results.find((r) => r.category.code === 'suv').quote.discount > 0);
  const fq = (await call('POST', '/api/quotes', { body: baseTrip({ promoCode: 'TENOFF' }) })).json.results.find((r) => r.category.code === 'suv');
  assert.equal(fq.quote.discount, 1000);
  // switching off, editing, and the deletion rules
  const id = made.json.promotion.id;
  assert.equal((await call('PATCH', `/api/admin/promotions/${id}`, { ...s, body: { active: false } })).status, 200);
  assert.equal((await call('POST', '/api/quotes', { body: baseTrip({ promoCode: 'summer15' }) })).json.promo.ok, false);
  assert.equal((await call('PATCH', `/api/admin/promotions/${id}`, { ...s, body: { value: 500 } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/promotions/${id}`, { ...s, body: { value: 20 } })).status, 200);
  assert.equal((await call('PATCH', '/api/admin/promotions/99999', { ...s, body: { active: true } })).status, 404);
  const used = (await db.query("SELECT id FROM promotions WHERE lower(code) = 'ten'")).rows[0].id;
  await db.query('UPDATE promotions SET uses_count = 1 WHERE id = $1', [used]);
  assert.equal((await call('DELETE', `/api/admin/promotions/${used}`, s)).status, 409);
  assert.equal((await call('DELETE', `/api/admin/promotions/${id}`, s)).status, 200);
  assert.equal((await call('DELETE', `/api/admin/promotions/${fixed.id}`, s)).status, 200);
});

test('admin: customers list, customer history and the contact message inbox', { skip }, async () => {
  const s = await ownerSession();
  assert.equal((await call('GET', '/api/admin/customers')).status, 401);
  const made2 = await book({}, { vehicle: 'suv' }); assert.equal(made2.res.status, 201, JSON.stringify(made2.res.json));
  const list = (await call('GET', '/api/admin/customers?q=ann%40example', s)).json;
  assert.ok(list.total >= 1); const ann = list.customers[0];
  assert.ok(ann.bookings >= 1); assert.ok(ann.value_cents > 0);
  assert.equal((await call('GET', '/api/admin/customers?q=zzzznobody', s)).json.total, 0);
  const one = (await call('GET', `/api/admin/customers/${ann.id}`, s)).json;
  assert.equal(one.customer.email, 'ann@example.com'); assert.ok(one.bookings.length >= 1);
  assert.equal((await call('GET', '/api/admin/customers/99999', s)).status, 404);
  // messages
  await call('POST', '/api/contact', { body: { name: 'Sam', email: 'sam@example.com', topic: 'quote', message: 'Penrith please', tripDetails: { from: 'Airport', to: 'Penrith' } } });
  const inbox = (await call('GET', '/api/admin/messages?handled=no', s)).json;
  assert.ok(inbox.open >= 1); const m = inbox.messages[0];
  assert.equal((await call('PATCH', `/api/admin/messages/${m.id}`, { ...s, body: { handled: 'yes' } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/messages/${m.id}`, { ...s, body: { handled: true } })).status, 200);
  assert.ok(!(await call('GET', '/api/admin/messages?handled=no', s)).json.messages.some((x) => x.id === m.id));
  assert.equal((await call('PATCH', '/api/admin/messages/99999', { ...s, body: { handled: true } })).status, 404);
});

test('admin: settings are owner-only, validated, saved, and used by the website', { skip }, async () => {
  const s = await ownerSession();
  assert.equal((await call('GET', '/api/admin/settings')).status, 401);
  const sl = await call('POST', '/api/admin/auth/login', { body: { email: 'staff@example.com', password: 'staff long passphrase' } });
  const staff = { cookie: sl.headers.get('set-cookie').split(';')[0], csrf: sl.json.csrfToken };
  assert.equal((await call('GET', '/api/admin/settings', staff)).status, 403);
  assert.equal((await call('PUT', '/api/admin/settings', { ...staff, body: { booking: { min_lead_minutes: 0, max_advance_days: 10 } } })).status, 403);
  const cur = (await call('GET', '/api/admin/settings', s)).json;
  const put = (body) => call('PUT', '/api/admin/settings', { ...s, body });
  const bad = await put({ business: { ...cur.business, email: 'nope', abn: '12', whatsapp: 'abc', name: '' } });
  assert.equal(bad.status, 400); assert.ok(bad.json.error.fields.email && bad.json.error.fields.abn && bad.json.error.fields.whatsapp && bad.json.error.fields.name);
  assert.equal((await put({ payments: { card_online: false, deposit: false, cash_to_driver: false } })).status, 400);
  assert.equal((await put({ booking: { min_lead_minutes: -5, max_advance_days: 0 } })).status, 400);
  const ok = await put({ business: { name: 'Sydney Airport Transfers', abn: '51 824 753 556', phone: '0412 345 678', email: 'book@sat.com.au', whatsapp: '61412345678', serviceArea: 'Sydney, NSW' }, payments: { card_online: true, deposit: false, cash_to_driver: true }, booking: { min_lead_minutes: 60, max_advance_days: 200 } });
  assert.equal(ok.status, 200); assert.equal(ok.json.business.phone, '0412 345 678');
  // the public website now shows the saved details
  const pub = (await call('GET', '/api/config/public')).json;
  assert.equal(pub.business.email, 'book@sat.com.au'); assert.equal(pub.payments.deposit, false);
  // a switched-off payment option can no longer be chosen at booking
  const trip = baseTrip(); const q = await call('POST', '/api/quotes', { body: trip });
  const r = q.json.results.find((x) => x.category.code === 'suv');
  const attempt = await call('POST', '/api/bookings', { body: { ...trip, vehicle: 'suv', quoteToken: r.token, payment: 'deposit', termsAccepted: true, idempotencyKey: `dep${Date.now()}abcdefghij`, customer: { name: 'Ann Lee', email: 'ann@example.com', phone: '0400 000 000' } } });
  assert.equal(attempt.status, 400); assert.equal(attempt.json.error.fields.payment.length > 0, true);
  // restore defaults for any later test
  await put({ payments: { card_online: true, deposit: true, cash_to_driver: true }, booking: { min_lead_minutes: 180, max_advance_days: 365 } });
});

// ---------------- Payments (Stripe is faked) ----------------
async function webhook(event, { secret = WHSEC, skew = 0 } = {}) {
  const raw = JSON.stringify(event);
  const t = Math.floor(clock().getTime() / 1000) + skew;
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const res = await fetch(`${base}/api/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: raw });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const paidEvent = (sessionId, id = `evt_${Math.random().toString(36).slice(2)}`) => {
  const sess = fake.sessions.get(sessionId); sess.payment_status = 'paid';
  return { id, type: 'checkout.session.completed', data: { object: { id: sess.id, payment_status: 'paid', payment_intent: sess.payment_intent, amount_total: sess.amount_total, metadata: sess.metadata } } };
};
const viewOf = async (b) => (await call('GET', `/api/bookings/${b.res.json.reference}?t=${b.res.json.viewToken}`)).json;
const adminId = async (s, b) => (await call('GET', '/api/admin/bookings?q=' + b.res.json.reference, s)).json.bookings[0].id;
async function staffSession() {
  const sl = await call('POST', '/api/admin/auth/login', { body: { email: 'staff@example.com', password: 'staff long passphrase' } });
  return { cookie: sl.headers.get('set-cookie').split(';')[0], csrf: sl.json.csrfToken };
}
const payNow = (b) => call('POST', `/api/bookings/${b.res.json.reference}/pay`, { body: { t: b.res.json.viewToken } });

test('payments: card checkout, signed webhook, duplicate events, and a forged webhook', { skip }, async () => {
  const b = await book({ extra: { payment: 'card_online' } }, { vehicle: 'suv' });
  assert.equal(b.res.status, 201);
  let v = await viewOf(b);
  assert.equal(v.payment.canPay, true); assert.equal(v.payment.dueCents, v.quote.total); assert.equal(v.payment.stripeReady, true);
  assert.equal((await call('POST', `/api/bookings/${b.res.json.reference}/pay`, { body: { t: 'wrong' } })).status, 404);
  const p = await payNow(b);
  assert.equal(p.status, 200); assert.match(p.json.url, /^https:\/\/checkout\.stripe\.test\//); assert.equal(p.json.amountCents, v.quote.total);
  const sess = [...fake.sessions.values()].at(-1);
  assert.equal(sess.params.line_items[0].price_data.currency, 'aud'); assert.match(sess.params.success_url, /^https:\/\/example\.test\/public\/confirmation\.html\?ref=.*&paid=1$/);
  assert.equal((await viewOf(b)).paymentStatus, 'pending');
  // forged, unsigned, and stale webhooks are refused
  const evt = paidEvent(sess.id); sess.payment_status = 'unpaid';
  assert.equal((await webhook(evt, { secret: 'whsec_wrong' })).status, 400);
  assert.equal((await webhook(evt, { skew: -4000 })).status, 400);
  assert.equal((await fetch(`${base}/api/webhooks/stripe`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await viewOf(b)).paymentStatus, 'pending');
  // the real one marks it paid, and replaying it changes nothing
  assert.equal((await webhook(evt)).status, 200);
  v = await viewOf(b);
  assert.equal(v.paymentStatus, 'paid'); assert.equal(v.payment.canPay, false); assert.equal(v.payment.netPaidCents, v.quote.total);
  assert.equal((await webhook(evt)).json.duplicate, true);
  assert.equal((await call('POST', `/api/bookings/${b.res.json.reference}/pay`, { body: { t: b.res.json.viewToken } })).status, 409);
});

test('payments: deposit, paying the rest, and syncing when the webhook was missed', { skip }, async () => {
  const b = await book({ extra: { payment: 'deposit' } }, { vehicle: 'suv' });
  let v = await viewOf(b);
  assert.equal(v.payment.dueCents, Math.round(v.quote.total * 0.3)); assert.equal(v.payment.label, 'Pay deposit');
  await payNow(b);
  const s1 = [...fake.sessions.values()].at(-1);
  assert.equal(s1.amount_total, v.payment.dueCents);
  // no webhook arrives; returning from Stripe asks Stripe directly
  s1.payment_status = 'paid';
  const sync = await call('POST', `/api/bookings/${b.res.json.reference}/pay/sync`, { body: { t: b.res.json.viewToken } });
  assert.equal(sync.status, 200);
  v = await viewOf(b);
  assert.equal(v.paymentStatus, 'partially_paid'); assert.equal(v.payment.label, 'Pay the remaining balance'); assert.equal(v.payment.dueCents, v.quote.total - s1.amount_total);
  await payNow(b);
  const s2 = [...fake.sessions.values()].at(-1);
  await webhook(paidEvent(s2.id));
  assert.equal((await viewOf(b)).paymentStatus, 'paid');
});

test('payments: cancelling refunds the card; a fee after "on the way" is kept; staff cancel refunds everything', { skip }, async () => {
  const s = await ownerSession();
  const post = (path, body) => call('POST', path, { ...s, body });
  // 1. free cancellation: everything comes back
  const a = await book({ extra: { payment: 'card_online' } }, { vehicle: 'suv' });
  await payNow(a); await webhook(paidEvent([...fake.sessions.values()].at(-1).id));
  const before = fake.refunds.length;
  const ca = await call('POST', `/api/bookings/${a.res.json.reference}/cancel`, { body: { t: a.res.json.viewToken } });
  assert.equal(ca.status, 200); assert.equal(ca.json.refundedCents, (await viewOf(a)).quote.total);
  assert.equal(fake.refunds.length, before + 1); assert.equal((await viewOf(a)).paymentStatus, 'refunded');
  assert.equal((await call('POST', `/api/bookings/${a.res.json.reference}/cancel`, { body: { t: a.res.json.viewToken } })).status, 409);

  // 2. cancel after the driver is on the way: the set percentage is kept
  const d = (await post('/api/admin/drivers', { fullName: 'Fee Driver', phone: '0433 333 333' })).json.driver;
  const b = await book({ trip: { date: sydneyDate(20), time: '14:00' }, extra: { payment: 'card_online' } }, { vehicle: 'suv' });
  await payNow(b); await webhook(paidEvent([...fake.sessions.values()].at(-1).id));
  const id = await adminId(s, b);
  await post(`/api/admin/bookings/${id}/status`, { status: 'confirmed' });
  await post(`/api/admin/bookings/${id}/legs/1/driver`, { driverId: d.id });
  await post(`/api/admin/bookings/${id}/legs/1/status`, { status: 'en_route' });
  const total = (await viewOf(b)).quote.total;
  assert.equal((await call('POST', `/api/bookings/${b.res.json.reference}/cancel`, { body: { t: b.res.json.viewToken } })).status, 409); // must accept the fee
  const cb = await call('POST', `/api/bookings/${b.res.json.reference}/cancel`, { body: { t: b.res.json.viewToken, acceptFee: true } });
  const pct = (await call('GET', '/api/config/public')).json.cancellation.feePercent;
  const fee = Math.round((total * pct) / 100);
  assert.equal(cb.json.feeCents, fee); assert.equal(cb.json.refundedCents, total - fee);
  assert.equal((await viewOf(b)).paymentStatus, 'partially_refunded');

  // 3. staff decline refunds in full, and unpaid bookings need no refund
  const c = await book({ extra: { payment: 'card_online' } }, { vehicle: 'suv' });
  await payNow(c); await webhook(paidEvent([...fake.sessions.values()].at(-1).id));
  const idc = await adminId(s, c);
  const dec = await post(`/api/admin/bookings/${idc}/status`, { status: 'declined', reason: 'No driver' });
  assert.equal(dec.json.refundedCents, (await viewOf(c)).quote.total); assert.equal((await viewOf(c)).paymentStatus, 'refunded');
  const u = await book({}, { vehicle: 'suv' });
  const cu = await call('POST', `/api/bookings/${u.res.json.reference}/cancel`, { body: { t: u.res.json.viewToken } });
  assert.equal(cu.json.refundedCents, 0); assert.equal((await viewOf(u)).paymentStatus, 'unpaid');
});

test('payments: a failed refund does not undo the cancellation, shows as owed, and the owner can retry', { skip }, async () => {
  const s = await ownerSession();
  const b = await book({ extra: { payment: 'card_online' } }, { vehicle: 'suv' });
  await payNow(b); await webhook(paidEvent([...fake.sessions.values()].at(-1).id));
  fake.failRefunds = true;
  const c = await call('POST', `/api/bookings/${b.res.json.reference}/cancel`, { body: { t: b.res.json.viewToken } });
  fake.failRefunds = false;
  assert.equal(c.status, 200); assert.equal(c.json.refundFailed, true); assert.equal(c.json.refundedCents, 0);
  assert.equal((await viewOf(b)).status, 'cancelled'); assert.equal((await viewOf(b)).paymentStatus, 'paid');
  const id = await adminId(s, b);
  const list = (await call('GET', '/api/admin/payments', s)).json;
  assert.ok(list.overview.refundsDue.some((r) => r.bookingId === id));
  // staff cannot refund; the owner can
  const staff = await staffSession();
  assert.equal((await call('POST', `/api/admin/bookings/${id}/refund`, { ...staff, body: {} })).status, 403);
  const total = (await viewOf(b)).quote.total;
  assert.equal((await call('POST', `/api/admin/bookings/${id}/refund`, { ...s, body: { amountCents: total + 1 } })).status, 409);
  const ok = await call('POST', `/api/admin/bookings/${id}/refund`, { ...s, body: {} });
  assert.equal(ok.status, 200); assert.equal(ok.json.refundedCents, total);
  assert.equal((await viewOf(b)).paymentStatus, 'refunded');
  assert.ok(!(await call('GET', '/api/admin/payments', s)).json.overview.refundsDue.some((r) => r.bookingId === id));
  // refunding again finds nothing left to refund
  assert.equal((await call('POST', `/api/admin/bookings/${id}/refund`, { ...s, body: {} })).json.refundedCents, 0);
});

test('payments: cash recorded by staff, limits enforced, payments list and CSV', { skip }, async () => {
  const s = await ownerSession(); const staff = await staffSession();
  const b = await book({ extra: { payment: 'cash_to_driver' } }, { vehicle: 'suv' });
  const id = await adminId(s, b); const total = (await viewOf(b)).quote.total;
  assert.equal((await viewOf(b)).payment.canPay, false);
  assert.equal((await call('POST', `/api/bookings/${b.res.json.reference}/pay`, { body: { t: b.res.json.viewToken } })).status, 409);
  const rec = (who, body) => call('POST', `/api/admin/bookings/${id}/payments`, { ...who, body });
  assert.equal((await rec(staff, { kind: 'payment', method: 'cash', amountCents: 0 })).status, 400);
  assert.equal((await rec(staff, { kind: 'payment', method: 'crypto', amountCents: 500 })).status, 400);
  assert.equal((await rec(staff, { kind: 'payment', method: 'cash', amountCents: total + 1 })).status, 409);
  assert.equal((await rec(staff, { kind: 'payment', method: 'cash', amountCents: 1000, note: 'part' })).json.paymentStatus, 'partially_paid');
  assert.equal((await rec(staff, { kind: 'payment', method: 'cash', amountCents: total - 1000 })).json.paymentStatus, 'paid');
  assert.equal((await rec(staff, { kind: 'refund', method: 'cash', amountCents: 500 })).status, 403);
  assert.equal((await rec(s, { kind: 'refund', method: 'cash', amountCents: total + 500 })).status, 409);
  assert.equal((await rec(s, { kind: 'refund', method: 'cash', amountCents: 500 })).json.paymentStatus, 'partially_refunded');
  const detail = (await call('GET', `/api/admin/bookings/${id}`, s)).json;
  assert.equal(detail.payments.length, 3); assert.equal(detail.paymentSummary.net, total - 500);
  const list = (await call('GET', '/api/admin/payments?kind=refund', s)).json;
  assert.ok(list.payments.every((x) => x.kind === 'refund')); assert.ok(list.collectedCents > 0);
  assert.equal((await call('GET', '/api/admin/payments?from=2030-02-01&to=2030-01-01', s)).status, 400);
  const csv = await fetch(`${base}/api/admin/payments/export`, { headers: { Cookie: s.cookie } });
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/);
  const text = await csv.text(); assert.ok(text.includes(b.res.json.reference)); assert.ok(text.includes('Date (Sydney)'));
  assert.equal((await fetch(`${base}/api/admin/payments/export`, { headers: { Cookie: staff.cookie } })).status, 403);
  // dashboard figures now exist
  const stats = (await call('GET', '/api/admin/dashboard/stats', s)).json;
  assert.equal(typeof stats.recordedRevenue, 'number'); assert.equal(typeof stats.pendingPayments, 'number');
});

test('reports: owner-only, correct totals for a date range, grouping validated', { skip }, async () => {
  const s = await ownerSession(); const staff = await staffSession();
  assert.equal((await call('GET', '/api/admin/reports', staff)).status, 403);
  assert.equal((await call('GET', '/api/admin/reports')).status, 401);
  assert.equal((await call('GET', '/api/admin/reports?group=year', s)).status, 400);
  assert.equal((await call('GET', '/api/admin/reports?from=2020-01-01&to=2026-12-31', s)).status, 400);
  const r = (await call('GET', '/api/admin/reports', s)).json;
  const direct = (await db.query("SELECT count(*)::int AS n FROM bookings WHERE created_at > now() - interval '30 days'")).rows[0].n;
  assert.equal(r.totals.bookings, direct);
  const money = (await db.query("SELECT COALESCE(sum(amount_cents) FILTER (WHERE kind='payment'),0)::int AS c, COALESCE(sum(amount_cents) FILTER (WHERE kind='refund'),0)::int AS r FROM payments WHERE status='succeeded'")).rows[0];
  assert.equal(r.totals.collectedCents, money.c); assert.equal(r.totals.refundedCents, money.r); assert.equal(r.totals.netCents, money.c - money.r);
  assert.equal(r.series.reduce((a, x) => a + x.bookings, 0), r.totals.bookings);
  assert.ok(Array.isArray(r.topRoutes) && Array.isArray(r.byVehicle));
  const weekly = (await call('GET', '/api/admin/reports?group=month', s)).json; assert.equal(weekly.group, 'month');
  const none = (await call('GET', '/api/admin/reports?from=2026-01-01&to=2026-01-02', s)).json; assert.equal(none.totals.bookings, 0);
});

test('settings: deposit percentage is validated, saved and used for deposits', { skip }, async () => {
  const s = await ownerSession();
  assert.equal((await call('PUT', '/api/admin/settings', { ...s, body: { deposit: { percent: 2 } } })).json.error.fields.deposit_percent.length > 0, true);
  const ok = await call('PUT', '/api/admin/settings', { ...s, body: { deposit: { percent: 50 } } });
  assert.equal(ok.json.deposit.percent, 50); assert.equal(ok.json.stripe.ready, true); assert.equal(ok.json.stripe.webhook, true);
  assert.equal((await call('GET', '/api/config/public')).json.deposit.percent, 50);
  const b = await book({ extra: { payment: 'deposit' } }, { vehicle: 'suv' });
  const v = await viewOf(b); assert.equal(v.payment.dueCents, Math.round(v.quote.total / 2));
  await call('PUT', '/api/admin/settings', { ...s, body: { deposit: { percent: 30 } } });
});

// ---------------- Distance pricing (routing is faked) ----------------
const PARRA = { label: '1 Church St, Parramatta NSW', lat: -33.815, lng: 151.0011 };
const MANLY = { label: 'Manly Wharf, Manly NSW', lat: -33.7993, lng: 151.285 };
const distTrip = (o = {}) => baseTrip({ pickup: PARRA, destination: MANLY, ...o });

test('distance pricing: off without routing, then base + per km with a minimum, cached, and booked at the same price', { skip }, async () => {
  const quote = (t = distTrip()) => call('POST', '/api/quotes', { body: t });
  // routing unavailable: still a manual quote, as before
  let q = (await quote()).json; assert.equal(q.manualQuote, true); assert.equal(q.distance, null);
  fakeRoute.on = true; fakeRoute.calls = 0;
  q = (await quote()).json;
  assert.equal(q.manualQuote, false); assert.equal(fakeRoute.calls, 1);
  const meters = Math.round(distanceM(PARRA.lat, PARRA.lng, MANLY.lat, MANLY.lng) * 1.3);
  assert.equal(q.distance.km, Math.round(meters / 100) / 10); assert.equal(q.distance.minutes, 30);
  const rates = (await db.query('SELECT vc.code, r.* FROM distance_rates r JOIN vehicle_categories vc ON vc.id = r.vehicle_category_id JOIN pricing_rule_sets rs ON rs.id = r.rule_set_id AND rs.is_active')).rows;
  const sedan = q.results.find((r) => r.category.code === 'sedan'); const rate = rates.find((r) => r.code === 'sedan');
  assert.equal(sedan.method, 'distance'); assert.equal(sedan.quote.subtotal, distanceFare(rate, meters).cents);
  assert.match(sedan.quote.lines[0].label, /km\)/); assert.equal(sedan.quote.subtotal % 100, 0);
  // the same trip again uses the remembered distance
  await quote(); assert.equal(fakeRoute.calls, 1);
  // a return trip repeats the distance fare with the return discount; fixed-route trips never ask the routing service
  const ret = (await quote(distTrip({ tripType: 'return', returnDate: sydneyDate(11), returnTime: '16:00' }))).json;
  assert.equal(ret.results.find((r) => r.category.code === 'suv').quote.lines.length, 2);
  const callsBefore = fakeRoute.calls;
  assert.equal((await quote(baseTrip({ destination: { label: 'Bondi Beach' } }))).json.manualQuote, false); assert.equal(fakeRoute.calls, callsBefore);
  // booking at the quoted price saves the distance; moving the destination afterwards is refused
  const suv = q.results.find((r) => r.category.code === 'suv');
  const body = { ...distTrip(), vehicle: 'suv', quoteToken: suv.token, payment: 'cash_to_driver', termsAccepted: true, idempotencyKey: `dist${Date.now()}abcdefghij`, customer: { name: 'Ann Lee', email: 'ann@example.com', phone: '0400 000 000' } };
  const moved = await call('POST', '/api/bookings', { body: { ...body, idempotencyKey: `dist2${Date.now()}abcdefghij`, destination: { label: 'Palm Beach NSW', lat: -33.5963, lng: 151.3233 } } });
  assert.equal(moved.status, 409);
  const ok = await call('POST', '/api/bookings', { body });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const row = (await db.query('SELECT pricing_method, quote_breakdown, quoted_total_cents FROM bookings WHERE reference = $1', [ok.json.reference])).rows[0];
  assert.equal(row.pricing_method, 'distance'); assert.equal(row.quote_breakdown.distanceKm, q.distance.km); assert.equal(row.quoted_total_cents, suv.quote.total);
  assert.equal(row.quote_breakdown.pickupArea, 'Parramatta');
  // the pricing token cannot be reused for a different vehicle's price
  assert.equal((await call('POST', '/api/bookings', { body: { ...body, vehicle: 'van', idempotencyKey: `dist3${Date.now()}abcdefghij` } })).status >= 400, true);
  fakeRoute.on = false;
});

test('distance pricing: outside Sydney, a failed lookup, or switched off all fall back to a manual quote', { skip }, async () => {
  fakeRoute.on = true; fakeRoute.calls = 0;
  const NEWCASTLE = { label: 'Newcastle NSW', lat: -32.9283, lng: 151.7817 };
  const far = (await call('POST', '/api/quotes', { body: distTrip({ destination: NEWCASTLE }) })).json;
  assert.equal(far.manualQuote, true); assert.equal(fakeRoute.calls, 0); // never even asked
  const MEL = { label: 'Melbourne VIC', lat: -37.8136, lng: 144.9631 };
  assert.equal((await call('POST', '/api/quotes', { body: distTrip({ pickup: MEL }) })).json.manualQuote, true);
  const same = (await call('POST', '/api/quotes', { body: distTrip({ destination: { ...PARRA, label: 'Parramatta station' } }) })).json;
  assert.equal(same.manualQuote, true);
  // a lookup for a new pair fails: manual quote, and nothing broken is remembered
  fakeRoute.on = false;
  const NEWTOWN = { label: 'Newtown NSW', lat: -33.8985, lng: 151.1793 };
  const down = (await call('POST', '/api/quotes', { body: distTrip({ destination: NEWTOWN }) })).json;
  assert.equal(down.manualQuote, true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM route_cache WHERE key LIKE '-33.8985%' OR key LIKE '%>-33.8985%'")).rows[0].n, 0);
  fakeRoute.on = true;
  assert.equal((await call('POST', '/api/quotes', { body: distTrip({ destination: NEWTOWN }) })).json.manualQuote, false);
  fakeRoute.on = false;
});

test('admin: distance rates are editable (owner only, validated, versioned) and can be switched off', { skip }, async () => {
  const s = await ownerSession(); const staff = await staffSession();
  assert.equal((await call('GET', '/api/admin/pricing', staff)).status, 403);
  const cur = (await call('GET', '/api/admin/pricing', s)).json;
  assert.equal(cur.distanceEnabled, true); assert.equal(cur.routingReady, true); assert.equal(cur.rates.sedan.perKmCents > 0, true);
  const put = (body) => call('PUT', '/api/admin/pricing', { ...s, body });
  assert.equal((await put({ rates: [{ vehicle: 'sedan', baseCents: 0, perKmCents: 0, minCents: 5000 }] })).status, 400);
  assert.equal((await put({ rates: [{ vehicle: 'sedan', baseCents: 1000, perKmCents: 300, minCents: 50 }] })).status, 400);
  assert.equal((await put({ rates: [{ vehicle: 'nope', baseCents: 1000, perKmCents: 300, minCents: 5000 }] })).status, 400);
  assert.equal((await put({ distanceEnabled: 'yes' })).status, 400);
  const ok = await put({ rates: [{ vehicle: 'sedan', baseCents: 2000, perKmCents: 400, minCents: 9000 }] });
  assert.equal(ok.status, 200); assert.equal(ok.json.version, cur.version + 1);
  assert.deepEqual(ok.json.pricing.rates.sedan, { baseCents: 2000, perKmCents: 400, minCents: 9000 });
  assert.equal(ok.json.pricing.rates.suv.perKmCents, cur.rates.suv.perKmCents); // others carried over
  fakeRoute.on = true;
  const q = (await call('POST', '/api/quotes', { body: distTrip() })).json;
  const meters = Math.round(distanceM(PARRA.lat, PARRA.lng, MANLY.lat, MANLY.lng) * 1.3);
  assert.equal(q.results.find((r) => r.category.code === 'sedan').quote.subtotal, distanceFare({ base_cents: 2000, per_km_cents: 400, min_cents: 9000 }, meters).cents);
  // off: those trips need a manual quote again
  assert.equal((await put({ distanceEnabled: false })).json.pricing.distanceEnabled, false);
  assert.equal((await call('POST', '/api/quotes', { body: distTrip() })).json.manualQuote, true);
  assert.equal((await put({ distanceEnabled: true })).status, 200);
  // clearing all three boxes removes a vehicle's distance pricing
  assert.equal((await put({ rates: [{ vehicle: 'luxury', baseCents: null, perKmCents: null, minCents: null }] })).json.pricing.rates.luxury, undefined);
  assert.equal((await call('POST', '/api/quotes', { body: distTrip() })).json.results.find((r) => r.category.code === 'luxury').status, 'no_fixed_fare');
  // a new vehicle copied from another gets scaled per-km rates
  const nv = await call('POST', '/api/admin/vehicles', { ...s, body: { name: 'Minibus', passengers: 11, luggage: 10, copyFaresFrom: 'van', farePercent: 150 } });
  assert.equal(nv.status, 201);
  const after = (await call('GET', '/api/admin/pricing', s)).json;
  assert.equal(after.rates.minibus.perKmCents, Math.round(after.rates.van.perKmCents * 1.5));
  assert.equal((await call('GET', '/api/config/public')).json.distancePricing, true);
  fakeRoute.on = false;
});
