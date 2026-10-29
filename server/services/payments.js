// Payments: Stripe Checkout for card and deposit, manual cash/bank records, refunds, and the figures behind them.
// Rules: money is integer cents; a booking's payment_status is always recomputed from its payment rows (never set by hand).
import { ApiError } from '../lib/validate.js';
import { percentOf } from '../lib/money.js';
import { getSettings } from './settings.js';

const FUND_SQL = `
  COALESCE(sum(p.amount_cents) FILTER (WHERE p.kind = 'payment' AND p.status = 'succeeded'), 0)::int AS paid,
  COALESCE(sum(p.amount_cents) FILTER (WHERE p.kind = 'refund'  AND p.status = 'succeeded'), 0)::int AS refunded,
  COALESCE(sum(p.amount_cents) FILTER (WHERE p.kind = 'payment' AND p.status = 'succeeded' AND p.method = 'card'), 0)::int AS card_paid,
  COALESCE(sum(p.amount_cents) FILTER (WHERE p.kind = 'refund'  AND p.status = 'succeeded' AND p.method = 'card'), 0)::int AS card_refunded,
  COALESCE(sum(p.amount_cents) FILTER (WHERE p.status = 'pending' AND p.kind = 'payment'), 0)::int AS pending_in`;

/** What has been paid and refunded for one booking. */
export async function paymentSummary(db, bookingId) {
  const r = (await db.query(`SELECT ${FUND_SQL} FROM payments p WHERE p.booking_id = $1`, [bookingId])).rows[0];
  return shape(r);
}
const shape = (r) => ({ paid: r.paid, refunded: r.refunded, net: r.paid - r.refunded, cardNet: r.card_paid - r.card_refunded, pendingIn: r.pending_in });

/** Set bookings.payment_status from the payment rows. */
export async function recomputePaymentStatus(db, bookingId) {
  const b = (await db.query('SELECT quoted_total_cents FROM bookings WHERE id = $1', [bookingId])).rows[0];
  if (!b) return null;
  const s = await paymentSummary(db, bookingId);
  const anyFailed = (await db.query("SELECT 1 FROM payments WHERE booking_id = $1 AND kind = 'payment' AND status = 'failed' LIMIT 1", [bookingId])).rows.length > 0;
  let status;
  if (s.refunded > 0) status = s.net <= 0 ? 'refunded' : 'partially_refunded';
  else if (s.paid >= b.quoted_total_cents && s.paid > 0) status = 'paid';
  else if (s.paid > 0) status = 'partially_paid';
  else if (s.pendingIn > 0) status = 'pending';
  else status = anyFailed ? 'failed' : 'unpaid';
  await db.query('UPDATE bookings SET payment_status = $2 WHERE id = $1 AND payment_status <> $2', [bookingId, status]);
  return { ...s, status };
}

const depositFor = (total, percent) => Math.min(total, Math.max(1, percentOf(total, percent)));

/** What the customer sees on their booking page: how much is paid, whether they can pay, and how much. */
export async function customerPaymentView(db, stripe, reference) {
  const b = (await db.query('SELECT id, status, payment_preference, quoted_total_cents, cancellation_fee_cents FROM bookings WHERE reference = $1', [String(reference || '').toUpperCase()])).rows[0];
  if (!b) return null;
  const settings = await getSettings(db);
  const s = await paymentSummary(db, b.id);
  const total = b.quoted_total_cents;
  const remaining = Math.max(0, total - s.net);
  const online = b.payment_preference === 'card_online' || b.payment_preference === 'deposit';
  const open = ['pending', 'confirmed'].includes(b.status);
  const deposit = depositFor(total, settings.deposit.percent);
  let due = 0; let label = 'Pay now';
  if (b.payment_preference === 'deposit' && s.net === 0) { due = Math.min(deposit, remaining); label = 'Pay deposit'; }
  else if (online || s.net > 0) { due = remaining; label = s.net > 0 ? 'Pay the remaining balance' : 'Pay now'; }
  const stripeReady = Boolean(stripe);
  return {
    totalCents: total, paidCents: s.paid, refundedCents: s.refunded, netPaidCents: s.net, remainingCents: remaining, depositCents: deposit,
    dueCents: due, label, stripeReady, awaiting: s.pendingIn > 0,
    canPay: stripeReady && open && online && due > 0,
    // A cancellation fee not covered by what was already paid
    feeOwedCents: b.status === 'cancelled' ? Math.max(0, b.cancellation_fee_cents - Math.max(0, s.net)) : 0,
  };
}

/** Mark a Checkout Session as paid (idempotent). Used by the webhook and by the "sync" check after returning from Stripe. */
export async function applyCheckoutSession(tx, session) {
  const bookingId = Number(session.metadata?.booking_id);
  if (!Number.isInteger(bookingId)) return false;
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const row = (await tx.query('SELECT id, status FROM payments WHERE stripe_session_id = $1 FOR UPDATE', [session.id])).rows[0];
  if (session.payment_status !== 'paid') return false;
  if (row) {
    if (row.status !== 'succeeded') await tx.query("UPDATE payments SET status = 'succeeded', stripe_payment_intent_id = $2, failure_reason = NULL WHERE id = $1", [row.id, intent]);
  } else {
    // We never saw this session locally (e.g. a crash after creating it): record it from Stripe's data.
    const ok = (await tx.query('SELECT 1 FROM bookings WHERE id = $1', [bookingId])).rows.length;
    if (!ok || !Number.isInteger(session.amount_total) || session.amount_total < 1) return false;
    await tx.query("INSERT INTO payments (booking_id, kind, method, amount_cents, status, stripe_session_id, stripe_payment_intent_id, note) VALUES ($1,'payment','card',$2,'succeeded',$3,$4,'Recorded from Stripe')", [bookingId, session.amount_total, session.id, intent]);
  }
  await recomputePaymentStatus(tx, bookingId);
  return true;
}

/** Create a Stripe Checkout page for what the customer still owes online. Returns the URL to send them to. */
export async function startCheckout(db, config, stripe, { booking, token }) {
  if (!stripe) throw new ApiError(503, 'PAYMENTS_OFF', 'Online card payment is not available right now. Please contact us to pay.');
  const view = await customerPaymentView(db, stripe, booking.reference);
  if (!view.canPay) throw new ApiError(409, 'NOT_PAYABLE', view.remainingCents <= 0 ? 'This booking is already paid.' : 'This booking cannot be paid online.');
  const deposit = booking.payment_preference === 'deposit' && view.netPaidCents === 0;

  // Close any older unpaid checkout pages so the customer cannot pay twice.
  const old = (await db.query("SELECT id, stripe_session_id FROM payments WHERE booking_id = $1 AND kind = 'payment' AND status = 'pending' AND stripe_session_id IS NOT NULL", [booking.id])).rows;
  for (const o of old) { try { await stripe.expireSession(o.stripe_session_id); } catch { /* already finished or expired */ } }
  await db.query("UPDATE payments SET status = 'expired' WHERE booking_id = $1 AND kind = 'payment' AND status = 'pending'", [booking.id]);

  const pay = (await db.query("INSERT INTO payments (booking_id, kind, method, amount_cents, status, note) VALUES ($1,'payment','card',$2,'pending',$3) RETURNING id", [booking.id, view.dueCents, deposit ? 'Deposit' : null])).rows[0];
  const back = `${config.publicUrl}/public/confirmation.html?ref=${encodeURIComponent(booking.reference)}&t=${encodeURIComponent(token)}`;
  try {
    const session = await stripe.createCheckoutSession({
      mode: 'payment',
      'payment_method_types': ['card'],
      line_items: [{ quantity: 1, price_data: { currency: 'aud', unit_amount: view.dueCents, product_data: { name: `Airport transfer ${booking.reference}${deposit ? ' (deposit)' : ''}` } } }],
      customer_email: booking.customer_email,
      client_reference_id: booking.reference,
      metadata: { booking_id: String(booking.id), reference: booking.reference, payment_id: String(pay.id) },
      payment_intent_data: { description: `Airport transfer ${booking.reference}`, metadata: { booking_id: String(booking.id), reference: booking.reference } },
      success_url: `${back}&paid=1`,
      cancel_url: back,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }, `checkout-${pay.id}`);
    await db.query('UPDATE payments SET stripe_session_id = $2 WHERE id = $1', [pay.id, session.id]);
    await recomputePaymentStatus(db, booking.id);
    return { url: session.url, amountCents: view.dueCents };
  } catch (e) {
    await db.query("UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1", [pay.id, 'Could not start checkout']);
    await recomputePaymentStatus(db, booking.id);
    throw e;
  }
}

/** Ask Stripe about this booking's open checkout pages and record any that were paid (covers a missed webhook). */
export async function syncPending(db, stripe, bookingId) {
  if (!stripe) return 0;
  const open = (await db.query("SELECT stripe_session_id FROM payments WHERE booking_id = $1 AND kind = 'payment' AND status IN ('pending','expired') AND stripe_session_id IS NOT NULL", [bookingId])).rows;
  let applied = 0;
  for (const o of open) {
    try {
      const session = await stripe.retrieveSession(o.stripe_session_id);
      if (session.payment_status === 'paid') { await db.tx((tx) => applyCheckoutSession(tx, session)); applied += 1; }
    } catch { /* provider hiccup: the webhook will catch up */ }
  }
  return applied;
}

/** Handle one verified Stripe webhook event, once only. */
export async function handleStripeEvent(db, event) {
  return db.tx(async (tx) => {
    const fresh = await tx.query('INSERT INTO stripe_events (id, type) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING RETURNING id', [event.id, event.type]);
    if (!fresh.rows.length) return { duplicate: true };
    const obj = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await applyCheckoutSession(tx, obj); break;
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed': {
        const failed = event.type.endsWith('failed');
        const r = await tx.query("UPDATE payments SET status = $2, failure_reason = $3 WHERE stripe_session_id = $1 AND status = 'pending' RETURNING booking_id", [obj.id, failed ? 'failed' : 'expired', failed ? 'Payment failed' : null]);
        for (const row of r.rows) await recomputePaymentStatus(tx, row.booking_id);
        break;
      }
      default: break; // other events are ignored
    }
    return { duplicate: false };
  });
}

/**
 * Return money to the customer's card. Without amountCents it refunds everything paid by card except `retainCents`
 * (the cancellation fee). Safe to call again: it only ever refunds what is still refundable.
 * Never throws for provider problems; it reports them so the cancellation itself is not undone.
 */
export async function refundBooking(db, stripe, bookingId, { retainCents = 0, amountCents = null, userId = null, note = null } = {}) {
  const plan = await db.tx(async (tx) => {
    await tx.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
    const s = await paymentSummary(tx, bookingId);
    const pays = (await tx.query(
      `SELECT p.id, p.amount_cents, p.stripe_payment_intent_id,
              p.amount_cents - COALESCE((SELECT sum(r.amount_cents) FROM payments r WHERE r.parent_payment_id = p.id AND r.status IN ('succeeded','pending')), 0) AS refundable
         FROM payments p WHERE p.booking_id = $1 AND p.kind = 'payment' AND p.status = 'succeeded' AND p.method = 'card' AND p.stripe_payment_intent_id IS NOT NULL
        ORDER BY p.id DESC`, [bookingId])).rows;
    const refundable = pays.reduce((a, p) => a + Number(p.refundable), 0);
    if (amountCents !== null && amountCents > refundable) throw new ApiError(409, 'TOO_MUCH', 'That is more than was paid by card and not yet refunded.');
    let want = amountCents !== null ? amountCents : Math.min(Math.max(0, s.net - retainCents), s.cardNet, refundable);
    const items = [];
    for (const p of pays) {
      if (want <= 0) break;
      const take = Math.min(want, Number(p.refundable));
      if (take <= 0) continue;
      const row = (await tx.query("INSERT INTO payments (booking_id, kind, method, amount_cents, status, parent_payment_id, note, created_by_user_id) VALUES ($1,'refund','card',$2,'pending',$3,$4,$5) RETURNING id", [bookingId, take, p.id, note, userId])).rows[0];
      items.push({ rowId: row.id, intent: p.stripe_payment_intent_id, take });
      want -= take;
    }
    return items;
  });
  if (!plan.length) return { refundedCents: 0, failed: false };
  let refunded = 0; let failed = false; let message = '';
  for (const it of plan) {
    try {
      if (!stripe) throw new ApiError(503, 'PAYMENTS_OFF', 'Card refunds are not set up.');
      const r = await stripe.createRefund({ payment_intent: it.intent, amount: it.take, reason: 'requested_by_customer', metadata: { payment_row: String(it.rowId) } }, `refund-${it.rowId}`);
      await db.query("UPDATE payments SET status = $2, stripe_refund_id = $3, failure_reason = $4 WHERE id = $1", [it.rowId, r.status === 'failed' ? 'failed' : 'succeeded', r.id || null, r.status === 'failed' ? 'Refund failed' : null]);
      if (r.status === 'failed') { failed = true; message = 'The card refund failed.'; } else refunded += it.take;
    } catch (e) {
      failed = true; message = e.message;
      await db.query("UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1", [it.rowId, String(e.message).slice(0, 200)]);
    }
  }
  await recomputePaymentStatus(db, bookingId);
  return { refundedCents: refunded, failed, message };
}

/** After a cancellation/decline: refund automatically, and report what happened. */
export async function autoRefund(db, stripe, bookingId, { retainCents = 0, log = console } = {}) {
  try { return await refundBooking(db, stripe, bookingId, { retainCents }); }
  catch (e) { log.error('Auto refund failed:', e); return { refundedCents: 0, failed: true, message: 'The refund could not be started.' }; }
}

const METHODS = ['cash', 'bank', 'other'];
/** Staff record money taken or returned outside Stripe (cash to the driver, a bank transfer). */
export async function recordManual(db, bookingId, { kind, method, amountCents, note }, userId) {
  if (!['payment', 'refund'].includes(kind)) throw new ApiError(400, 'VALIDATION', 'Choose payment or refund.');
  if (!METHODS.includes(method)) throw new ApiError(400, 'VALIDATION', 'Choose cash, bank or other.');
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 5_000_000) throw new ApiError(400, 'VALIDATION', 'Enter an amount.');
  const text = typeof note === 'string' ? note.trim().slice(0, 200) : '';
  return db.tx(async (tx) => {
    const b = (await tx.query('SELECT id, quoted_total_cents FROM bookings WHERE id = $1 FOR UPDATE', [bookingId])).rows[0];
    if (!b) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.');
    const s = await paymentSummary(tx, bookingId);
    if (kind === 'payment' && s.net + amountCents > b.quoted_total_cents) throw new ApiError(409, 'TOO_MUCH', 'That would be more than the booking total.');
    const nonCardNet = s.net - s.cardNet;
    if (kind === 'refund' && amountCents > nonCardNet) throw new ApiError(409, 'TOO_MUCH', 'Only cash or bank money recorded here can be refunded here. Card payments are refunded to the card.');
    await tx.query("INSERT INTO payments (booking_id, kind, method, amount_cents, status, note, created_by_user_id) VALUES ($1,$2,$3,$4,'succeeded',$5,$6)", [bookingId, kind, method, amountCents, text || null, userId]);
    return recomputePaymentStatus(tx, bookingId);
  });
}

export async function bookingPayments(db, bookingId) {
  const rows = (await db.query('SELECT id, kind, method, amount_cents, status, note, failure_reason, parent_payment_id, created_at FROM payments WHERE booking_id = $1 ORDER BY id', [bookingId])).rows;
  const s = await paymentSummary(db, bookingId);
  const refundableCard = (await db.query(
    `SELECT COALESCE(sum(p.amount_cents - COALESCE((SELECT sum(r.amount_cents) FROM payments r WHERE r.parent_payment_id = p.id AND r.status IN ('succeeded','pending')), 0)), 0)::int AS n
       FROM payments p WHERE p.booking_id = $1 AND p.kind = 'payment' AND p.status = 'succeeded' AND p.method = 'card' AND p.stripe_payment_intent_id IS NOT NULL`, [bookingId])).rows[0].n;
  return { payments: rows, summary: { ...s, refundableCardCents: refundableCard } };
}

const csvCell = (v) => { let t = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const TZ = 'Australia/Sydney';
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
/** Sydney-date range (inclusive) as SQL parameters. */
export function parseRange(from, to, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
  const start = isDate(from) ? from : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(now.getTime() - 29 * 86400000));
  const end = isDate(to) ? to : today;
  if (start > end) throw new ApiError(400, 'VALIDATION', 'The start date must be before the end date.');
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 400) throw new ApiError(400, 'VALIDATION', 'Please choose a range of 13 months or less.');
  return { from: start, to: end };
}
const RANGE = (col) => `${col} >= ($1::date)::timestamp AT TIME ZONE '${TZ}' AND ${col} < (($2::date) + 1)::timestamp AT TIME ZONE '${TZ}'`;

export async function listPayments(db, { from, to, kind = '', page = 1, pageSize = 25 } = {}, now = new Date()) {
  const r = parseRange(from, to, now);
  const params = [r.from, r.to]; let extra = '';
  if (kind) { if (!['payment', 'refund'].includes(kind)) throw new ApiError(400, 'VALIDATION', 'Unknown type.'); params.push(kind); extra = ` AND p.kind = $${params.length}`; }
  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100); const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const where = `WHERE ${RANGE('p.created_at')}${extra}`;
  const total = (await db.query(`SELECT count(*)::int AS n FROM payments p ${where}`, params)).rows[0].n;
  const rows = (await db.query(
    `SELECT p.id, p.kind, p.method, p.amount_cents, p.status, p.note, p.failure_reason, p.created_at, b.id AS booking_id, b.reference, c.full_name AS customer_name
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN customers c ON c.id = b.customer_id ${where}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ${size} OFFSET ${offset}`, params)).rows;
  const sums = (await db.query(
    `SELECT COALESCE(sum(amount_cents) FILTER (WHERE kind='payment' AND status='succeeded'),0)::int AS collected,
            COALESCE(sum(amount_cents) FILTER (WHERE kind='refund' AND status='succeeded'),0)::int AS refunded
       FROM payments p WHERE ${RANGE('p.created_at')}`, [r.from, r.to])).rows[0];
  return { range: r, total, page: Math.max(Number(page) || 1, 1), pageSize: size, payments: rows, collectedCents: sums.collected, refundedCents: sums.refunded, netCents: sums.collected - sums.refunded };
}

export async function exportPayments(db, range, now = new Date()) {
  const r = parseRange(range.from, range.to, now);
  const rows = (await db.query(
    `SELECT p.created_at, b.reference, c.full_name, p.kind, p.method, p.status, p.amount_cents, p.note
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN customers c ON c.id = b.customer_id
      WHERE ${RANGE('p.created_at')} ORDER BY p.created_at, p.id`, [r.from, r.to])).rows;
  const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
  return toCsv([['Date (Sydney)', 'Booking', 'Customer', 'Type', 'Method', 'Status', 'Amount (AUD)', 'GST included (AUD)', 'Note'],
    ...rows.map((x) => [fmt.format(new Date(x.created_at)), x.reference, x.full_name, x.kind, x.method, x.status, ((x.kind === 'refund' ? -1 : 1) * x.amount_cents / 100).toFixed(2), ((x.kind === 'refund' ? -1 : 1) * Math.round(x.amount_cents / 11) / 100).toFixed(2), x.note || ''])]);
}

/** Per-booking money position for active bookings and refunds still owed. */
export async function paymentOverview(db) {
  const settings = await getSettings(db);
  const rows = (await db.query(
    `SELECT b.id, b.reference, b.status, b.payment_preference AS pref, b.quoted_total_cents AS total, b.cancellation_fee_cents AS fee, c.full_name AS customer_name, ${FUND_SQL}
       FROM bookings b JOIN customers c ON c.id = b.customer_id LEFT JOIN payments p ON p.booking_id = b.id
      GROUP BY b.id, c.full_name`)).rows;
  let onlinePending = 0; let balanceDue = 0; const refundsDue = [];
  for (const r of rows) {
    const s = shape(r);
    if (['pending', 'confirmed'].includes(r.status)) {
      balanceDue += Math.max(0, r.total - s.net);
      if (r.pref === 'card_online') onlinePending += Math.max(0, r.total - s.net);
      if (r.pref === 'deposit') onlinePending += Math.max(0, depositFor(r.total, settings.deposit.percent) - s.net);
    }
    if (['cancelled', 'declined'].includes(r.status)) {
      const owed = Math.min(s.cardNet, Math.max(0, s.net - (r.status === 'cancelled' ? r.fee : 0)));
      if (owed > 0) refundsDue.push({ bookingId: r.id, reference: r.reference, customerName: r.customer_name, owedCents: owed });
    }
  }
  const net = rows.reduce((a, r) => a + r.paid - r.refunded, 0);
  return { recordedRevenueCents: net, pendingPaymentsCents: onlinePending, balanceDueCents: balanceDue, refundsDue };
}

/** Business report for a Sydney-date range. Bookings are counted by when they were made; money by when it moved. */
export async function buildReport(db, { from, to, group = 'day' }, now = new Date()) {
  const r = parseRange(from, to, now);
  if (!['day', 'week', 'month'].includes(group)) throw new ApiError(400, 'VALIDATION', 'Unknown grouping.');
  const P = [r.from, r.to];
  const bk = RANGE('b.created_at');
  const label = `to_char(date_trunc('${group}', %s AT TIME ZONE '${TZ}'), 'YYYY-MM-DD')`;
  const [totals, status, series, money, vehicles, routes, pref, fees] = await Promise.all([
    db.query(`SELECT count(*)::int AS bookings,
                     COALESCE(sum(quoted_total_cents) FILTER (WHERE status IN ('confirmed','completed')),0)::int AS booked_value,
                     COALESCE(round(avg(quoted_total_cents) FILTER (WHERE status IN ('confirmed','completed'))),0)::int AS avg_fare
                FROM bookings b WHERE ${bk}`, P),
    db.query(`SELECT status, count(*)::int AS n FROM bookings b WHERE ${bk} GROUP BY status`, P),
    db.query(`SELECT ${label.replace('%s', 'b.created_at')} AS period, count(*)::int AS bookings,
                     COALESCE(sum(quoted_total_cents) FILTER (WHERE status IN ('confirmed','completed')),0)::int AS booked_value
                FROM bookings b WHERE ${bk} GROUP BY 1 ORDER BY 1`, P),
    db.query(`SELECT ${label.replace('%s', 'p.created_at')} AS period,
                     COALESCE(sum(amount_cents) FILTER (WHERE kind='payment'),0)::int AS collected,
                     COALESCE(sum(amount_cents) FILTER (WHERE kind='refund'),0)::int AS refunded
                FROM payments p WHERE p.status = 'succeeded' AND ${RANGE('p.created_at')} GROUP BY 1 ORDER BY 1`, P),
    db.query(`SELECT vc.name, count(*)::int AS bookings, COALESCE(sum(b.quoted_total_cents),0)::int AS value
                FROM bookings b JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id
               WHERE ${bk} AND b.status IN ('confirmed','completed') GROUP BY vc.name ORDER BY value DESC`, P),
    db.query(`SELECT (b.quote_breakdown->>'pickupArea') AS pickup, (b.quote_breakdown->>'destinationArea') AS destination, count(*)::int AS bookings, COALESCE(sum(b.quoted_total_cents),0)::int AS value
                FROM bookings b WHERE ${bk} AND b.status IN ('confirmed','completed') GROUP BY 1, 2 ORDER BY bookings DESC, value DESC LIMIT 10`, P),
    db.query(`SELECT payment_preference AS pref, count(*)::int AS n FROM bookings b WHERE ${bk} GROUP BY 1`, P),
    db.query(`SELECT COALESCE(sum(cancellation_fee_cents),0)::int AS fees FROM bookings b WHERE status = 'cancelled' AND ${RANGE('b.cancelled_at')}`, P),
  ]);
  // Merge the two time series so every period appears once
  const map = new Map();
  for (const x of series.rows) map.set(x.period, { period: x.period, bookings: x.bookings, bookedValueCents: x.booked_value, collectedCents: 0, refundedCents: 0 });
  for (const x of money.rows) { const e = map.get(x.period) || { period: x.period, bookings: 0, bookedValueCents: 0, collectedCents: 0, refundedCents: 0 }; e.collectedCents = x.collected; e.refundedCents = x.refunded; map.set(x.period, e); }
  const collected = money.rows.reduce((a, x) => a + x.collected, 0); const refunded = money.rows.reduce((a, x) => a + x.refunded, 0);
  const t = totals.rows[0];
  return {
    range: r, group,
    totals: { bookings: t.bookings, bookedValueCents: t.booked_value, averageFareCents: t.avg_fare, collectedCents: collected, refundedCents: refunded, netCents: collected - refunded, gstOnNetCents: Math.round((collected - refunded) / 11), cancellationFeesCents: fees.rows[0].fees },
    byStatus: Object.fromEntries(status.rows.map((x) => [x.status, x.n])),
    series: [...map.values()].sort((a, b) => a.period.localeCompare(b.period)),
    byVehicle: vehicles.rows.map((x) => ({ name: x.name, bookings: x.bookings, valueCents: x.value })),
    topRoutes: routes.rows.map((x) => ({ pickup: x.pickup || '—', destination: x.destination || '—', bookings: x.bookings, valueCents: x.value })),
    byPayment: Object.fromEntries(pref.rows.map((x) => [x.pref, x.n])),
  };
}
