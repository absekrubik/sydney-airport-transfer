// Read-only customer list and the contact-form inbox for the admin.
import { ApiError } from '../lib/validate.js';

export async function listCustomers(db, { q = '', page = 1, pageSize = 25 } = {}) {
  const params = []; let where = '';
  if (q) { params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`); where = `WHERE c.full_name ILIKE $1 OR c.email ILIKE $1 OR c.phone ILIKE $1`; }
  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
  const total = (await db.query(`SELECT count(*)::int AS n FROM customers c ${where}`, params)).rows[0].n;
  const rows = (await db.query(
    `SELECT c.id, c.full_name, c.email, c.phone, c.marketing_opt_in, c.created_at,
            count(b.id)::int AS bookings,
            COALESCE(sum(b.quoted_total_cents) FILTER (WHERE b.status IN ('pending','confirmed','completed')), 0)::bigint AS value_cents,
            max(b.created_at) AS last_booking_at
       FROM customers c LEFT JOIN bookings b ON b.customer_id = c.id ${where}
      GROUP BY c.id ORDER BY max(b.created_at) DESC NULLS LAST, c.id DESC LIMIT ${size} OFFSET ${offset}`, params)).rows;
  return { total, page: Math.max(Number(page) || 1, 1), pageSize: size, customers: rows.map((r) => ({ ...r, value_cents: Number(r.value_cents) })) };
}

export async function getCustomer(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'NOT_FOUND', 'Customer not found.');
  const c = (await db.query('SELECT id, full_name, email, phone, marketing_opt_in, created_at FROM customers WHERE id = $1', [n])).rows[0];
  if (!c) throw new ApiError(404, 'NOT_FOUND', 'Customer not found.');
  const bookings = (await db.query(
    `SELECT b.id, b.reference, b.status, b.payment_status, b.quoted_total_cents, b.created_at, vc.name AS vehicle,
            (SELECT min(pickup_at) FROM booking_legs WHERE booking_id = b.id) AS first_pickup_at
       FROM bookings b JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id WHERE b.customer_id = $1 ORDER BY b.created_at DESC`, [n])).rows;
  return { customer: c, bookings };
}

export async function listMessages(db, { handled = '' } = {}) {
  const where = handled === 'yes' ? 'WHERE is_handled' : handled === 'no' ? 'WHERE NOT is_handled' : '';
  const rows = (await db.query(`SELECT id, name, email, phone, topic, message, trip_details, is_handled, created_at FROM contact_messages ${where} ORDER BY is_handled, created_at DESC LIMIT 200`)).rows;
  const open = (await db.query('SELECT count(*)::int AS n FROM contact_messages WHERE NOT is_handled')).rows[0].n;
  return { messages: rows, open };
}

export async function setMessageHandled(db, id, handled) {
  if (typeof handled !== 'boolean') throw new ApiError(400, 'VALIDATION', 'Invalid value.');
  const r = await db.query('UPDATE contact_messages SET is_handled = $2 WHERE id = $1 RETURNING id', [Number(id) || 0, handled]);
  if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Message not found.');
  return { handled };
}
