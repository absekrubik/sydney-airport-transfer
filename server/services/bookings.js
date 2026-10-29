import { loadPricing } from './pricing.js';
import { attachDistance } from './distance.js';
import { findPromo, verifyQuote } from './quotes.js';
import { getSettings } from './settings.js';
import { newReference, randomToken, sha256, safeEqual } from '../lib/crypto.js';
import { ApiError } from '../lib/validate.js';
import { formatSydney } from '../lib/time.js';
import { gstFromTotal, percentOf } from '../lib/money.js';

const NOT_CANCELLABLE_LEG = ['in_progress', 'completed', 'no_show'];

/**
 * Create a booking request (status "pending"). Everything happens in one transaction:
 * customer, booking, legs and status history either all save or none do.
 */
export async function createBooking(db, config, input, now = new Date(), { routing = null, log = console } = {}) {
  return db.tx(async (tx) => {
    // Same key again (double click or a retry after a lost response): return the same booking.
    const existing = await tx.query('SELECT id, reference FROM bookings WHERE idempotency_key = $1', [input.idempotencyKey]);
    if (existing.rows.length) {
      const viewToken = randomToken(); // the first response may never have arrived, so issue a fresh link
      await tx.query('UPDATE bookings SET view_token_hash = $1 WHERE id = $2', [sha256(viewToken), existing.rows[0].id]);
      return { reference: existing.rows[0].reference, viewToken, replay: true };
    }

    const settings = await getSettings(tx);
    if (!settings.payments[input.payment]) throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.', { payment: 'That payment option is not available' });
    const earliest = new Date(now.getTime() + settings.booking.min_lead_minutes * 60000);
    const latest = new Date(now.getTime() + settings.booking.max_advance_days * 86400000);
    if (input.pickupAt < earliest) throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.', { date: `Please book at least ${Math.round(settings.booking.min_lead_minutes / 60)} hours ahead, or call us for urgent trips` });
    if (input.pickupAt > latest) throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.', { date: 'That date is too far ahead' });

    const data = await loadPricing(tx);
    const promo = await findPromo(tx, input.promoCode);
    await attachDistance(tx, routing, input, data, promo, now, log);
    const { priced, result } = verifyQuote(config, data, input, promo, input.vehicle, input.quoteToken, now);
    const quote = result.quote;
    const category = data.categories.find((c) => c.code === input.vehicle);

    let promotionId = null;
    if (promo && result.promo?.ok) {
      // Count the use atomically so two bookings cannot both take the last use
      const used = await tx.query('UPDATE promotions SET uses_count = uses_count + 1 WHERE id = $1 AND (max_uses IS NULL OR uses_count < max_uses) RETURNING id', [promo.id]);
      if (!used.rows.length) throw new ApiError(409, 'PRICE_CHANGED', 'That promo code has just been fully used. Please review the new price.');
      promotionId = promo.id;
    }

    const c = input.customer;
    const cust = await tx.query(
      `INSERT INTO customers (full_name, email, phone, marketing_opt_in) VALUES ($1, $2, $3, $4)
       ON CONFLICT ((lower(email))) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone,
         marketing_opt_in = customers.marketing_opt_in OR EXCLUDED.marketing_opt_in
       RETURNING id`, [c.fullName, c.email, c.phone, input.marketingOptIn]);
    const customerId = cust.rows[0].id;

    const viewToken = randomToken();
    const breakdown = { lines: quote.lines, subtotal: quote.subtotal, discount: quote.discount, total: quote.total, gst: quote.gst, rulesVersion: data.ruleSet.version_number, sample: data.ruleSet.is_sample, pickupArea: priced.from?.label || input.pickup.label, destinationArea: priced.to?.label || input.destination.label,
      ...(result.method === 'distance' ? { distanceKm: Math.round(data.distance.distanceM / 100) / 10 } : {}) };
    let booking = null;
    for (let attempt = 0; attempt < 5 && !booking; attempt += 1) {
      const reference = newReference();
      const ins = await tx.query(
        `INSERT INTO bookings (reference, customer_id, trip_type, payment_preference, passengers, luggage, child_seats, vehicle_category_id,
           flight_number, notes_customer, quoted_total_cents, gst_cents, discount_cents, quote_breakdown, pricing_rule_set_id, promotion_id,
           idempotency_key, view_token_hash, pricing_method)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (reference) DO NOTHING RETURNING id, reference`,
        [reference, customerId, input.tripType, input.payment, input.passengers, input.luggage, input.childSeats, category.id,
          input.flight || null, input.notes || null, quote.total, quote.gst, quote.discount, JSON.stringify(breakdown), data.ruleSet.id, promotionId,
          input.idempotencyKey, sha256(viewToken), result.method]);
      if (ins.rows.length) booking = ins.rows[0];
    }
    if (!booking) throw new ApiError(500, 'SERVER_ERROR', 'We could not create the booking. Please try again.');

    const legs = [{ n: 1, type: 'outbound', from: input.pickup, to: input.destination, at: input.pickupAt }];
    if (input.tripType === 'return') legs.push({ n: 2, type: 'return', from: input.destination, to: input.pickup, at: input.returnAt });
    for (const leg of legs) {
      await tx.query(
        `INSERT INTO booking_legs (booking_id, leg_number, leg_type, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, pickup_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [booking.id, leg.n, leg.type, leg.from.label, leg.from.lat, leg.from.lng, leg.to.label, leg.to.lat, leg.to.lng, leg.at.toISOString()]);
    }
    await tx.query('INSERT INTO booking_status_history (booking_id, to_status, reason) VALUES ($1, $2, $3)', [booking.id, 'pending', 'Booking requested on the website']);
    return { reference: booking.reference, viewToken, replay: false };
  });
}

/** What it would cost to cancel right now. Free until a leg is en route. */
export function cancellationPolicy(booking, legs, feePercent) {
  const locked = legs.some((l) => NOT_CANCELLABLE_LEG.includes(l.leg_status));
  const alreadyDone = ['cancelled', 'declined', 'completed'].includes(booking.status);
  const feeApplies = legs.some((l) => l.leg_status === 'en_route');
  return {
    allowed: !locked && !alreadyDone,
    feePercent: feeApplies ? feePercent : 0,
    feeCents: feeApplies ? percentOf(booking.quoted_total_cents, feePercent) : 0,
    reason: alreadyDone ? `This booking is already ${booking.status}.` : locked ? 'This trip has already started, so it cannot be cancelled online. Please call us.' : '',
  };
}

export async function loadBookingByToken(db, reference, token) {
  const { rows } = await db.query(
    `SELECT b.*, c.full_name AS customer_name, c.email AS customer_email, vc.name AS vehicle_name FROM bookings b
       JOIN customers c ON c.id = b.customer_id JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id
      WHERE b.reference = $1`, [String(reference || '').toUpperCase()]);
  const booking = rows[0];
  // Same error for "no such booking" and "wrong token" so references cannot be probed
  if (!booking || !token || !safeEqual(booking.view_token_hash, sha256(String(token)))) throw new ApiError(404, 'NOT_FOUND', 'We could not find that booking. Check the link in your confirmation.');
  const legs = (await db.query('SELECT * FROM booking_legs WHERE booking_id = $1 ORDER BY leg_number', [booking.id])).rows;
  return { booking, legs };
}

/** GET /api/bookings/:reference?t=token (the customer's own view; no internal notes, no other people's data). */
export async function getBookingForCustomer(db, reference, token) {
  const { booking, legs } = await loadBookingByToken(db, reference, token);
  const settings = await getSettings(db);
  return {
    reference: booking.reference,
    status: booking.status,
    paymentStatus: booking.payment_status,
    paymentPreference: booking.payment_preference,
    tripType: booking.trip_type,
    customerName: booking.customer_name,
    vehicle: booking.vehicle_name,
    passengers: booking.passengers,
    luggage: booking.luggage,
    childSeats: booking.child_seats,
    flight: booking.flight_number || '',
    notes: booking.notes_customer || '',
    legs: legs.map((l) => ({ number: l.leg_number, type: l.leg_type, from: l.pickup_address, to: l.dropoff_address, pickupAt: l.pickup_at.toISOString ? l.pickup_at.toISOString() : l.pickup_at, pickupLocal: formatSydney(new Date(l.pickup_at)), status: l.leg_status })),
    quote: { lines: booking.quote_breakdown.lines, total: booking.quoted_total_cents, gst: booking.gst_cents, sample: Boolean(booking.quote_breakdown.sample) },
    business: { name: settings.business.name, abn: settings.business.abn, phone: settings.business.phone, email: settings.business.email },
    cancellation: { ...cancellationPolicy(booking, legs, settings.cancellation.fee_percent), feeCentsCharged: booking.cancellation_fee_cents },
    createdAt: booking.created_at,
  };
}

/** POST /api/bookings/:reference/cancel. If a fee applies the customer must explicitly accept it. */
export async function cancelBookingAsCustomer(db, reference, token, { acceptFee = false, reason = '' } = {}) {
  return db.tx(async (tx) => {
    const { booking, legs } = await loadBookingByToken(tx, reference, token);
    await tx.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [booking.id]); // stop two cancels racing
    const fresh = (await tx.query('SELECT * FROM bookings WHERE id = $1', [booking.id])).rows[0];
    const freshLegs = (await tx.query('SELECT * FROM booking_legs WHERE booking_id = $1', [booking.id])).rows;
    const settings = await getSettings(tx);
    const policy = cancellationPolicy(fresh, freshLegs, settings.cancellation.fee_percent);
    if (!policy.allowed) throw new ApiError(409, 'NOT_CANCELLABLE', policy.reason);
    if (policy.feeCents > 0 && acceptFee !== true) throw new ApiError(409, 'FEE_NOT_ACCEPTED', `A cancellation fee of ${policy.feePercent}% applies because your driver is already on the way.`, { feeCents: String(policy.feeCents) });
    await tx.query("UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancellation_fee_cents = $2 WHERE id = $1", [booking.id, policy.feeCents]);
    await tx.query("UPDATE booking_legs SET leg_status = 'cancelled' WHERE booking_id = $1 AND leg_status NOT IN ('completed')", [booking.id]);
    await tx.query('INSERT INTO booking_status_history (booking_id, from_status, to_status, reason) VALUES ($1,$2,$3,$4)',
      [booking.id, fresh.status, 'cancelled', (String(reason).slice(0, 300) || 'Cancelled by customer') + (policy.feeCents ? ` (fee ${policy.feeCents} cents)` : '')]);
    return { reference: booking.reference, status: 'cancelled', feeCents: policy.feeCents, gstOnFeeCents: gstFromTotal(policy.feeCents) };
  });
}
