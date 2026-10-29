import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, parseQuoteInput, parseBookingInput, parseContactInput, throwIfErrors } from './lib/validate.js';
import { createRouter, createRateLimiter, createStatic, readJson, readRaw, sendJson, parseCookies, cookieHeader, securityHeaders } from './http.js';
import { loadPricing } from './services/pricing.js';
import { createQuotes } from './services/quotes.js';
import { createBooking, getBookingForCustomer, cancelBookingAsCustomer } from './services/bookings.js';
import { getSettings, parseSettingsInput, saveSettings } from './services/settings.js';
import { login, logout, getSession, changePassword } from './services/auth.js';
import { dashboardStats, listBookings, getBookingAdmin } from './services/admin.js';
import { safeEqual } from './lib/crypto.js';
import { parseVehicleInput, listAllVehicles, createVehicle, updateVehicle, deleteVehicle } from './services/vehicles.js';
import { parseDriverInput, listDrivers, createDriver, updateDriver, deleteDriver } from './services/drivers.js';
import { setBookingStatus, setLegStatus, assignDriver, setInternalNotes, LEG_STATUSES } from './services/manage.js';
import { getPricingAdmin, parsePricingInput, savePricing } from './services/pricing-admin.js';
import { parsePromoInput, listPromos, createPromo, updatePromo, deletePromo } from './services/promotions.js';
import { listCustomers, getCustomer, listMessages, setMessageHandled } from './services/customers.js';
import { createRouting } from './services/routing.js';
import { createStripe, verifyStripeSignature } from './services/stripe.js';
import { customerPaymentView, startCheckout, syncPending, handleStripeEvent, autoRefund, refundBooking, recordManual, listPayments, exportPayments, paymentOverview, buildReport } from './services/payments.js';
import { loadBookingByToken } from './services/bookings.js';
import { downloadImage } from './lib/fetch-image.js';
import { vehicleImage, saveVehicleImage, removeVehicleImage, DEFAULT_DIR, MAX_IMAGE_BYTES } from './lib/images.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_COOKIE = 'at_session';

export function createApp({ db, config, now = () => new Date(), log = console, stripe: stripeOverride, routing: routingOverride }) {
  // Tests pass a fake Stripe; otherwise it is created from STRIPE_SECRET_KEY (or null when payments are not set up).
  const stripe = stripeOverride !== undefined ? stripeOverride : createStripe({ secretKey: config.stripeSecretKey, log });
  // Driving distances for fares off the fixed routes; null when no ORS_API_KEY (those trips then need a manual quote)
  const routing = routingOverride !== undefined ? routingOverride : createRouting({ apiKey: config.orsApiKey, log });
  const imageDir = config.vehicleImageDir || DEFAULT_DIR;
  const router = createRouter();
  const limiter = createRateLimiter();
  const serveStatic = createStatic(ROOT, ['public', 'admin']);

  const clientIp = (req) => {
    if (config.trustProxy) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
    return req.socket.remoteAddress || '';
  };
  const limit = (ctx, name, max, windowMs) => {
    if (!limiter.check(`${name}:${ctx.ip}`, max * (config.rateLimitScale || 1), windowMs)) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.');
  };
  const audit = (userId, action, entity, entityId, ip) => db.query('INSERT INTO audit_log (user_id, action, entity, entity_id, ip) VALUES ($1,$2,$3,$4,$5)', [userId, action, entity, entityId ? String(entityId) : null, ip]).catch(() => {});

  // ---------------- Public API ----------------
  router.add('GET', '/api/config/public', async () => {
    const s = await getSettings(db);
    return { status: 200, body: { business: { name: s.business.name, abn: s.business.abn, phone: s.business.phone, email: s.business.email, whatsapp: s.business.whatsapp, serviceArea: s.business.serviceArea }, payments: s.payments, stripeReady: Boolean(stripe), distancePricing: Boolean(routing), deposit: { percent: s.deposit.percent }, cancellation: { feePercent: s.cancellation.fee_percent }, booking: { minLeadMinutes: s.booking.min_lead_minutes } } };
  });

  router.add('GET', '/api/vehicle-categories', async () => {
    const d = await loadPricing(db);
    return { status: 200, body: { vehicles: d.categories.map((c) => ({ image: vehicleImage(c.code, imageDir), code: c.code, name: c.name, example: c.example_model, passengers: c.passenger_capacity, luggage: c.luggage_capacity, features: c.features })) } };
  });

  router.add('GET', '/api/locations', async () => {
    const d = await loadPricing(db);
    return { status: 200, body: { locations: d.locations.map((l) => ({ label: l.label, kind: l.kind })) } };
  });

  // Fixed routes: one row per airport/area pair with the fare for each vehicle category
  router.add('GET', '/api/routes', async () => {
    const d = await loadPricing(db);
    const place = new Map(d.locations.map((l) => [l.id, l.label]));
    const code = new Map(d.categories.map((c) => [c.id, c.code]));
    const pairs = new Map();
    for (const r of d.routes) {
      const key = `${r.origin_id}|${r.destination_id}`;
      if (!pairs.has(key)) pairs.set(key, { from: place.get(r.origin_id), to: place.get(r.destination_id), fares: {} });
      if (code.has(r.vehicle_category_id)) pairs.get(key).fares[code.get(r.vehicle_category_id)] = r.fare_cents;
    }
    const routes = [...pairs.values()].filter((r) => r.from && r.to).map((r) => ({ ...r, fromCents: Math.min(...Object.values(r.fares)) }));
    return { status: 200, body: { sample: d.ruleSet.is_sample, routes } };
  });

  router.add('POST', '/api/quotes', async (ctx) => {
    limit(ctx, 'quote', 60, 60_000);
    const { errors, value } = parseQuoteInput(ctx.body);
    throwIfErrors(errors);
    return { status: 200, body: await createQuotes(db, config, value, { routing, log }) };
  });

  router.add('POST', '/api/bookings', async (ctx) => {
    limit(ctx, 'booking', 10, 3600_000);
    const parsed = parseBookingInput(ctx.body);
    if (parsed.honeypot) return { status: 202, body: { accepted: true } }; // a bot filled the hidden field: pretend success, save nothing
    throwIfErrors(parsed.errors);
    const result = await createBooking(db, config, parsed.value, now(), { routing, log });
    return { status: result.replay ? 200 : 201, body: { reference: result.reference, viewToken: result.viewToken } };
  });

  router.add('GET', '/api/bookings/:reference', async (ctx) => {
    const body = await getBookingForCustomer(db, ctx.params.reference, ctx.query.get('t'));
    body.payment = await customerPaymentView(db, stripe, body.reference);
    return { status: 200, body };
  });

  // Start card payment: returns a Stripe-hosted page to send the customer to
  router.add('POST', '/api/bookings/:reference/pay', async (ctx) => {
    limit(ctx, 'pay', 20, 3600_000);
    const token = typeof ctx.body?.t === 'string' ? ctx.body.t : '';
    const { booking } = await loadBookingByToken(db, ctx.params.reference, token);
    return { status: 200, body: await startCheckout(db, config, stripe, { booking, token }) };
  });
  // After coming back from Stripe: confirm with Stripe directly in case the webhook has not arrived yet
  router.add('POST', '/api/bookings/:reference/pay/sync', async (ctx) => {
    limit(ctx, 'pay-sync', 60, 3600_000);
    const { booking } = await loadBookingByToken(db, ctx.params.reference, typeof ctx.body?.t === 'string' ? ctx.body.t : '');
    await syncPending(db, stripe, booking.id);
    return { status: 200, body: { payment: await customerPaymentView(db, stripe, booking.reference) } };
  });

  // Stripe calls this when a payment completes or a checkout page expires. The signature proves it came from Stripe.
  router.add('POST', '/api/webhooks/stripe', async (ctx) => {
    if (!config.stripeWebhookSecret) throw new ApiError(503, 'WEBHOOK_OFF', 'Webhooks are not set up.');
    if (!verifyStripeSignature(ctx.raw || Buffer.alloc(0), ctx.req.headers['stripe-signature'], config.stripeWebhookSecret, now().getTime())) throw new ApiError(400, 'BAD_SIGNATURE', 'Invalid signature.');
    let event; try { event = JSON.parse(ctx.raw.toString('utf8')); } catch { throw new ApiError(400, 'BAD_REQUEST', 'Invalid payload.'); }
    if (!event?.id || !event?.type) throw new ApiError(400, 'BAD_REQUEST', 'Invalid event.');
    return { status: 200, body: { received: true, ...(await handleStripeEvent(db, event)) } };
  });

  router.add('POST', '/api/bookings/:reference/cancel', async (ctx) => {
    limit(ctx, 'cancel', 10, 3600_000);
    const b = ctx.body || {};
    const out = await cancelBookingAsCustomer(db, ctx.params.reference, typeof b.t === 'string' ? b.t : '', { acceptFee: b.acceptFee === true, reason: typeof b.reason === 'string' ? b.reason : '' });
    // Give back what was paid, minus any cancellation fee
    const id = (await db.query('SELECT id FROM bookings WHERE reference = $1', [out.reference])).rows[0].id;
    const refund = await autoRefund(db, stripe, id, { retainCents: out.feeCents, log });
    const view = await customerPaymentView(db, stripe, out.reference);
    return { status: 200, body: { ...out, refundedCents: refund.refundedCents, refundFailed: refund.failed, feeOwedCents: view.feeOwedCents } };
  });

  router.add('POST', '/api/contact', async (ctx) => {
    limit(ctx, 'contact', 5, 3600_000);
    const parsed = parseContactInput(ctx.body);
    if (parsed.honeypot) return { status: 202, body: { accepted: true } };
    throwIfErrors(parsed.errors);
    const v = parsed.value;
    await db.query('INSERT INTO contact_messages (name, email, phone, topic, message, trip_details) VALUES ($1,$2,$3,$4,$5,$6)', [v.name, v.email, v.phone, v.topic, v.message, v.tripDetails ? JSON.stringify(v.tripDetails) : null]);
    return { status: 201, body: { received: true } };
  });

  // ---------------- Admin API ----------------
  router.add('POST', '/api/admin/auth/login', async (ctx) => {
    limit(ctx, 'login', 20, 15 * 60_000);
    const b = ctx.body || {};
    try {
      const s = await login(db, { email: b.email, password: b.password, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] || '' }, now());
      await audit(s.user.id, 'login', 'user', s.user.id, ctx.ip);
      return { status: 200, body: { user: s.user, csrfToken: s.csrf }, headers: { 'Set-Cookie': cookieHeader(SESSION_COOKIE, s.token, { maxAgeSeconds: s.maxAgeSeconds, secure: config.cookieSecure }) } };
    } catch (e) {
      if (e instanceof ApiError) await audit(null, `login_failed:${e.code}`, 'user', null, ctx.ip);
      throw e;
    }
  });

  const authed = (handler, { role, csrf = true } = {}) => async (ctx) => {
    const session = await getSession(db, parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE], now());
    if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Please log in.');
    if (role && session.user.role !== role) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.');
    if (csrf && ctx.req.method !== 'GET' && !safeEqual(ctx.req.headers['x-csrf-token'] || '', session.csrf)) throw new ApiError(403, 'BAD_CSRF', 'Your session needs refreshing. Reload the page and try again.');
    ctx.session = session;
    return handler(ctx);
  };

  router.add('GET', '/api/admin/auth/me', authed((ctx) => ({ status: 200, body: { user: ctx.session.user, csrfToken: ctx.session.csrf } })));
  router.add('POST', '/api/admin/auth/logout', authed(async (ctx) => {
    await logout(db, parseCookies(ctx.req.headers.cookie)[SESSION_COOKIE]);
    await audit(ctx.session.user.id, 'logout', 'user', ctx.session.user.id, ctx.ip);
    return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': cookieHeader(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure: config.cookieSecure }) } };
  }));
  router.add('POST', '/api/admin/auth/change-password', authed(async (ctx) => {
    limit(ctx, 'chpw', 10, 3600_000);
    await changePassword(db, ctx.session, ctx.body?.currentPassword, ctx.body?.newPassword);
    await audit(ctx.session.user.id, 'change_password', 'user', ctx.session.user.id, ctx.ip);
    return { status: 200, body: { ok: true } };
  }));
  router.add('GET', '/api/admin/dashboard/stats', authed(async () => ({ status: 200, body: await dashboardStats(db, now()) })));
  router.add('GET', '/api/admin/bookings', authed(async (ctx) => ({ status: 200, body: await listBookings(db, { status: ctx.query.get('status') || '', q: (ctx.query.get('q') || '').slice(0, 100), page: ctx.query.get('page'), pageSize: ctx.query.get('pageSize') }) })));
  router.add('GET', '/api/admin/bookings/:id', authed(async (ctx) => ({ status: 200, body: await getBookingAdmin(db, ctx.params.id) })));

  // Vehicle photos: list, upload (raw image bytes in the request body) and remove
  const vehicleList = async () => (await listAllVehicles(db)).map((v) => ({ ...v, example: v.example, image: vehicleImage(v.code, imageDir) }));
  const knownVehicle = async (code) => {
    const r = await db.query('SELECT 1 FROM vehicle_categories WHERE code = $1', [code]);
    if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', 'That vehicle type does not exist.');
  };
  router.add('POST', '/api/admin/vehicles', authed(async (ctx) => {
    limit(ctx, 'vehicle-edit', 60, 3600_000);
    const { vehicle, faresCopied } = await createVehicle(db, parseVehicleInput(ctx.body));
    await audit(ctx.session.user.id, 'vehicle_create', 'vehicle_category', vehicle.code, ctx.ip);
    return { status: 201, body: { vehicle: { ...vehicle, image: vehicleImage(vehicle.code, imageDir) }, faresCopied } };
  }));
  router.add('PATCH', '/api/admin/vehicles/:code', authed(async (ctx) => {
    limit(ctx, 'vehicle-edit', 60, 3600_000);
    const vehicle = await updateVehicle(db, ctx.params.code, parseVehicleInput(ctx.body, { partial: true }));
    await audit(ctx.session.user.id, 'vehicle_update', 'vehicle_category', vehicle.code, ctx.ip);
    return { status: 200, body: { vehicle: { ...vehicle, image: vehicleImage(vehicle.code, imageDir) } } };
  }));
  router.add('DELETE', '/api/admin/vehicles/:code', authed(async (ctx) => {
    await deleteVehicle(db, ctx.params.code);
    removeVehicleImage(ctx.params.code, imageDir);
    await audit(ctx.session.user.id, 'vehicle_delete', 'vehicle_category', ctx.params.code, ctx.ip);
    return { status: 200, body: { ok: true } };
  }));
  router.add('GET', '/api/admin/vehicles', authed(async () => ({ status: 200, body: { vehicles: await vehicleList() } })));
  router.add('PUT', '/api/admin/vehicles/:code/image', authed(async (ctx) => {
    limit(ctx, 'upload', 30, 3600_000);
    await knownVehicle(ctx.params.code);
    const image = saveVehicleImage(ctx.params.code, ctx.raw, imageDir);
    await audit(ctx.session.user.id, 'vehicle_image_upload', 'vehicle_category', ctx.params.code, ctx.ip);
    return { status: 200, body: { image } };
  }));
  router.add('POST', '/api/admin/vehicles/:code/image-from-url', authed(async (ctx) => {
    limit(ctx, 'upload', 30, 3600_000);
    await knownVehicle(ctx.params.code);
    const bytes = await downloadImage(ctx.body?.url, { allowPrivate: config.allowPrivateImageFetch === true });
    const image = saveVehicleImage(ctx.params.code, bytes, imageDir);
    await audit(ctx.session.user.id, 'vehicle_image_from_url', 'vehicle_category', ctx.params.code, ctx.ip);
    return { status: 200, body: { image } };
  }));
  router.add('DELETE', '/api/admin/vehicles/:code/image', authed(async (ctx) => {
    await knownVehicle(ctx.params.code);
    const image = removeVehicleImage(ctx.params.code, imageDir);
    await audit(ctx.session.user.id, 'vehicle_image_remove', 'vehicle_category', ctx.params.code, ctx.ip);
    return { status: 200, body: { image } };
  }));

  // ---------------- Pricing (owner only: it changes what customers pay) ----------------
  router.add('GET', '/api/admin/pricing', authed(async () => ({ status: 200, body: await getPricingAdmin(db, await getSettings(db), { routingReady: Boolean(routing) }) }), { role: 'owner' }));
  router.add('PUT', '/api/admin/pricing', authed(async (ctx) => {
    limit(ctx, 'pricing-edit', 60, 3600_000);
    const result = await savePricing(db, parsePricingInput(ctx.body));
    await audit(ctx.session.user.id, 'pricing_save', 'pricing_rule_set', result.version, ctx.ip);
    return { status: 200, body: { ...result, pricing: await getPricingAdmin(db, await getSettings(db), { routingReady: Boolean(routing) }) } };
  }, { role: 'owner' }));

  // ---------------- Drivers ----------------
  router.add('GET', '/api/admin/drivers', authed(async () => ({ status: 200, body: { drivers: await listDrivers(db) } })));
  router.add('POST', '/api/admin/drivers', authed(async (ctx) => {
    limit(ctx, 'driver-edit', 120, 3600_000);
    const driver = await createDriver(db, parseDriverInput(ctx.body));
    await audit(ctx.session.user.id, 'driver_create', 'driver', driver.id, ctx.ip);
    return { status: 201, body: { driver } };
  }));
  router.add('PATCH', '/api/admin/drivers/:id', authed(async (ctx) => {
    limit(ctx, 'driver-edit', 120, 3600_000);
    const driver = await updateDriver(db, ctx.params.id, parseDriverInput(ctx.body, { partial: true }));
    await audit(ctx.session.user.id, 'driver_update', 'driver', driver.id, ctx.ip);
    return { status: 200, body: { driver } };
  }));
  router.add('DELETE', '/api/admin/drivers/:id', authed(async (ctx) => {
    await deleteDriver(db, ctx.params.id);
    await audit(ctx.session.user.id, 'driver_delete', 'driver', ctx.params.id, ctx.ip);
    return { status: 200, body: { ok: true } };
  }));

  // ---------------- Managing a booking ----------------
  router.add('POST', '/api/admin/bookings/:id/status', authed(async (ctx) => {
    limit(ctx, 'booking-edit', 300, 3600_000);
    const to = ctx.body?.status;
    if (!['confirmed', 'declined', 'cancelled', 'completed'].includes(to)) throw new ApiError(400, 'VALIDATION', 'Unknown status.');
    const r = await setBookingStatus(db, ctx.params.id, to, ctx.session.user.id, ctx.body?.reason);
    await audit(ctx.session.user.id, `booking_${to}`, 'booking', ctx.params.id, ctx.ip);
    // Declined or cancelled by staff: the customer gets everything back
    if (to === 'declined' || to === 'cancelled') {
      const refund = await autoRefund(db, stripe, Number(ctx.params.id), { log });
      return { status: 200, body: { ...r, refundedCents: refund.refundedCents, refundFailed: refund.failed } };
    }
    return { status: 200, body: r };
  }));
  router.add('POST', '/api/admin/bookings/:id/legs/:leg/status', authed(async (ctx) => {
    limit(ctx, 'booking-edit', 300, 3600_000);
    const to = ctx.body?.status;
    if (!LEG_STATUSES.includes(to)) throw new ApiError(400, 'VALIDATION', 'Unknown trip status.');
    const r = await setLegStatus(db, ctx.params.id, ctx.params.leg, to, ctx.session.user.id);
    await audit(ctx.session.user.id, `leg_${to}`, 'booking', ctx.params.id, ctx.ip);
    return { status: 200, body: r };
  }));
  router.add('POST', '/api/admin/bookings/:id/legs/:leg/driver', authed(async (ctx) => {
    limit(ctx, 'booking-edit', 300, 3600_000);
    const id = ctx.body?.driverId ?? null;
    const r = await assignDriver(db, ctx.params.id, ctx.params.leg, id, ctx.session.user.id, ctx.body?.force === true);
    await audit(ctx.session.user.id, id === null ? 'driver_unassign' : 'driver_assign', 'booking', ctx.params.id, ctx.ip);
    return { status: 200, body: r };
  }));
  router.add('PUT', '/api/admin/bookings/:id/notes', authed(async (ctx) => ({ status: 200, body: await setInternalNotes(db, ctx.params.id, ctx.body?.notes) })));

  // ---------------- Payments and reports ----------------
  router.add('POST', '/api/admin/bookings/:id/payments', authed(async (ctx) => {
    limit(ctx, 'payment-edit', 120, 3600_000);
    const b = ctx.body || {};
    const id = Number(ctx.params.id);
    if (b.kind === 'refund' && ctx.session.user.role !== 'owner') throw new ApiError(403, 'FORBIDDEN', 'Only the owner can record refunds.');
    const r = await recordManual(db, id, { kind: b.kind, method: b.method, amountCents: b.amountCents, note: b.note }, ctx.session.user.id);
    await audit(ctx.session.user.id, `payment_manual_${b.kind}`, 'booking', id, ctx.ip);
    return { status: 201, body: { paymentStatus: r.status } };
  }));
  // Refund to the customer's card (owner only)
  router.add('POST', '/api/admin/bookings/:id/refund', authed(async (ctx) => {
    limit(ctx, 'payment-edit', 120, 3600_000);
    const id = Number(ctx.params.id);
    const exists = (await db.query('SELECT 1 FROM bookings WHERE id = $1', [id])).rows.length;
    if (!exists) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.');
    const amt = ctx.body?.amountCents;
    let r;
    if (amt === undefined || amt === null) {
      // "Refund what is owed": everything paid by card except any cancellation fee
      const bk = (await db.query('SELECT status, cancellation_fee_cents FROM bookings WHERE id = $1', [id])).rows[0];
      r = await refundBooking(db, stripe, id, { retainCents: bk.status === 'cancelled' ? bk.cancellation_fee_cents : 0, userId: ctx.session.user.id, note: 'Refund by staff' });
    } else {
      if (!Number.isInteger(amt) || amt < 1) throw new ApiError(400, 'VALIDATION', 'Enter an amount.');
      r = await refundBooking(db, stripe, id, { amountCents: amt, userId: ctx.session.user.id, note: 'Refund by staff' });
    }
    await audit(ctx.session.user.id, 'refund', 'booking', id, ctx.ip);
    if (r.failed) throw new ApiError(502, 'REFUND_FAILED', r.message || 'The refund did not go through.');
    return { status: 200, body: r };
  }, { role: 'owner' }));
  router.add('GET', '/api/admin/payments', authed(async (ctx) => ({ status: 200, body: { ...(await listPayments(db, { from: ctx.query.get('from'), to: ctx.query.get('to'), kind: ctx.query.get('kind') || '', page: ctx.query.get('page'), pageSize: ctx.query.get('pageSize') }, now())), overview: await paymentOverview(db), stripe: { ready: Boolean(stripe), mode: stripe?.mode || null, webhook: Boolean(config.stripeWebhookSecret) } } })));
  router.add('GET', '/api/admin/payments/export', authed(async (ctx) => ({ status: 200, csv: await exportPayments(db, { from: ctx.query.get('from'), to: ctx.query.get('to') }, now()), filename: 'payments.csv' }), { role: 'owner' }));
  router.add('GET', '/api/admin/reports', authed(async (ctx) => ({ status: 200, body: await buildReport(db, { from: ctx.query.get('from'), to: ctx.query.get('to'), group: ctx.query.get('group') || 'day' }, now()) }), { role: 'owner' }));

  // ---------------- Promotions ----------------
  router.add('GET', '/api/admin/promotions', authed(async () => ({ status: 200, body: { promotions: await listPromos(db) } })));
  router.add('POST', '/api/admin/promotions', authed(async (ctx) => {
    limit(ctx, 'promo-edit', 60, 3600_000);
    const promotion = await createPromo(db, parsePromoInput(ctx.body));
    await audit(ctx.session.user.id, 'promo_create', 'promotion', promotion.id, ctx.ip);
    return { status: 201, body: { promotion } };
  }));
  router.add('PATCH', '/api/admin/promotions/:id', authed(async (ctx) => {
    limit(ctx, 'promo-edit', 120, 3600_000);
    const cur = (await db.query('SELECT type FROM promotions WHERE id = $1', [Number(ctx.params.id) || 0])).rows[0];
    if (!cur) throw new ApiError(404, 'NOT_FOUND', 'Promo code not found.');
    const promotion = await updatePromo(db, ctx.params.id, parsePromoInput({ ...(ctx.body || {}), type: cur.type }, { partial: true }));
    await audit(ctx.session.user.id, 'promo_update', 'promotion', promotion.id, ctx.ip);
    return { status: 200, body: { promotion } };
  }));
  router.add('DELETE', '/api/admin/promotions/:id', authed(async (ctx) => {
    await deletePromo(db, ctx.params.id);
    await audit(ctx.session.user.id, 'promo_delete', 'promotion', ctx.params.id, ctx.ip);
    return { status: 200, body: { ok: true } };
  }));

  // ---------------- Customers and messages ----------------
  router.add('GET', '/api/admin/customers', authed(async (ctx) => ({ status: 200, body: await listCustomers(db, { q: (ctx.query.get('q') || '').slice(0, 100), page: ctx.query.get('page'), pageSize: ctx.query.get('pageSize') }) })));
  router.add('GET', '/api/admin/customers/:id', authed(async (ctx) => ({ status: 200, body: await getCustomer(db, ctx.params.id) })));
  router.add('GET', '/api/admin/messages', authed(async (ctx) => ({ status: 200, body: await listMessages(db, { handled: ctx.query.get('handled') || '' }) })));
  router.add('PATCH', '/api/admin/messages/:id', authed(async (ctx) => {
    const r = await setMessageHandled(db, ctx.params.id, ctx.body?.handled);
    await audit(ctx.session.user.id, r.handled ? 'message_handled' : 'message_reopened', 'contact_message', ctx.params.id, ctx.ip);
    return { status: 200, body: r };
  }));

  // ---------------- Business settings (owner only) ----------------
  router.add('GET', '/api/admin/settings', authed(async () => {
    const s = await getSettings(db);
    return { status: 200, body: { business: s.business, payments: s.payments, deposit: s.deposit, booking: s.booking, stripe: { ready: Boolean(stripe), mode: stripe?.mode || null, webhook: Boolean(config.stripeWebhookSecret) } } };
  }, { role: 'owner' }));
  router.add('PUT', '/api/admin/settings', authed(async (ctx) => {
    limit(ctx, 'settings-edit', 60, 3600_000);
    const s = await saveSettings(db, parseSettingsInput(ctx.body));
    await audit(ctx.session.user.id, 'settings_save', 'settings', null, ctx.ip);
    return { status: 200, body: { business: s.business, payments: s.payments, deposit: s.deposit, booking: s.booking, stripe: { ready: Boolean(stripe), mode: stripe?.mode || null, webhook: Boolean(config.stripeWebhookSecret) } } };
  }, { role: 'owner' }));

  // ---------------- Request handler ----------------
  async function handler(req, res) {
    securityHeaders(res, config);
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        if (serveStatic(req, res, url.pathname)) return;
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return;
      }

      const m = router.match(req.method, url.pathname);
      if (m.methodNotAllowed) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      if (!m.handler) throw new ApiError(404, 'NOT_FOUND', 'Not found.');

      const ctx = { req, res, url, query: url.searchParams, params: m.params, ip: clientIp(req), body: null, session: null };
      if (!['GET', 'HEAD'].includes(req.method)) {
        // Browsers always send Origin on cross-site POSTs; refuse any that is not this site.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new ApiError(403, 'BAD_ORIGIN', 'Cross-site requests are not allowed.');
        if (url.pathname === '/api/webhooks/stripe') ctx.raw = await readRaw(req, 1_000_000); // signature is checked against the exact bytes
        else if ((req.headers['content-type'] || '').startsWith('image/')) ctx.raw = await readRaw(req, MAX_IMAGE_BYTES);
        else ctx.body = await readJson(req);
      }
      const out = await m.handler(ctx);
      if (out.headers) for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
      if (out.csv !== undefined) {
        const data = Buffer.from('\ufeff' + out.csv, 'utf8');
        res.writeHead(out.status, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.filename || 'export.csv'}"`, 'Content-Length': data.length, 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      sendJson(res, out.status, out.body);
    } catch (e) {
      if (e instanceof ApiError) {
        const headers = e.status === 429 ? { 'Retry-After': '60' } : {};
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
        return sendJson(res, e.status, { error: { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) } });
      }
      log.error(`Unhandled error on ${req.method} ${url.pathname}:`, e); // never send internals to the browser
      return sendJson(res, 500, { error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again.' } });
    }
  }

  return { handler };
}
