import { ApiError } from '../lib/validate.js';
import { paymentOverview, bookingPayments } from './payments.js';

const TZ = 'Australia/Sydney';

export async function dashboardStats(db, now = new Date()) {
  const iso = now.toISOString();
  const [counts, legs, money] = await Promise.all([
    db.query(`SELECT count(*)::int AS total,
                     count(*) FILTER (WHERE status = 'pending')::int AS pending,
                     count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
                     count(*) FILTER (WHERE status = 'completed')::int AS completed,
                     count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
                FROM bookings`),
    db.query(`SELECT count(*) FILTER (WHERE (l.pickup_at AT TIME ZONE '${TZ}')::date = ($1::timestamptz AT TIME ZONE '${TZ}')::date)::int AS today,
                     count(*) FILTER (WHERE l.pickup_at > $1::timestamptz AND l.pickup_at <= $1::timestamptz + interval '7 days')::int AS upcoming
                FROM booking_legs l JOIN bookings b ON b.id = l.booking_id
               WHERE b.status IN ('pending', 'confirmed') AND l.leg_status <> 'cancelled'`, [iso]),
    paymentOverview(db),
  ]);
  const c = counts.rows[0]; const l = legs.rows[0];
  return {
    totalBookings: c.total, pendingBookings: c.pending, confirmedBookings: c.confirmed, completedTrips: c.completed, cancelledBookings: c.cancelled,
    todaysTrips: l.today, upcomingTransfers: l.upcoming,
    // Money actually received (card, cash and bank, minus refunds), and online payments customers still owe.
    recordedRevenue: money.recordedRevenueCents, pendingPayments: money.pendingPaymentsCents,
  };
}

const STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'completed'];

export async function listBookings(db, { status = '', q = '', page = 1, pageSize = 25 } = {}) {
  const where = []; const params = [];
  if (status) { if (!STATUSES.includes(status)) throw new ApiError(400, 'VALIDATION', 'Unknown status.'); params.push(status); where.push(`b.status = $${params.length}`); }
  if (q) { params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`); where.push(`(b.reference ILIKE $${params.length} OR c.full_name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length})`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const total = (await db.query(`SELECT count(*)::int AS n FROM bookings b JOIN customers c ON c.id = b.customer_id ${clause}`, params)).rows[0].n;
  const rows = (await db.query(
    `SELECT b.id, b.reference, b.status, b.payment_status, b.trip_type, b.quoted_total_cents, b.created_at, c.full_name AS customer_name,
            vc.name AS vehicle, (SELECT min(pickup_at) FROM booking_legs WHERE booking_id = b.id) AS first_pickup_at,
            (SELECT pickup_address || ' → ' || dropoff_address FROM booking_legs WHERE booking_id = b.id ORDER BY leg_number LIMIT 1) AS route
       FROM bookings b JOIN customers c ON c.id = b.customer_id JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id ${clause}
      ORDER BY b.created_at DESC, b.id DESC LIMIT ${size} OFFSET ${offset}`, params)).rows;
  return { total, page: Math.max(Number(page) || 1, 1), pageSize: size, bookings: rows };
}

export async function getBookingAdmin(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.');
  const b = (await db.query(
    `SELECT b.*, c.full_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone, vc.name AS vehicle
       FROM bookings b JOIN customers c ON c.id = b.customer_id JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id WHERE b.id = $1`, [n])).rows[0];
  if (!b) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.');
  delete b.view_token_hash; delete b.idempotency_key;
  const legs = (await db.query(`SELECT l.*, d.full_name AS driver_name, d.phone AS driver_phone, d.vehicle_details AS driver_vehicle
       FROM booking_legs l LEFT JOIN drivers d ON d.id = l.driver_id WHERE l.booking_id = $1 ORDER BY l.leg_number`, [n])).rows;
  const history = (await db.query('SELECT * FROM booking_status_history WHERE booking_id = $1 ORDER BY id', [n])).rows;
  const pay = await bookingPayments(db, n);
  return { booking: b, legs, history, payments: pay.payments, paymentSummary: pay.summary };
}
