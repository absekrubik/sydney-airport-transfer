// Admin actions on a booking: confirm/decline/cancel/complete, move a trip through its stages, assign a driver.
import { ApiError, paragraph } from '../lib/validate.js';

// What a booking's status may change to. "completed" is set automatically when every trip is completed.
const BOOKING_NEXT = {
  pending: ['confirmed', 'declined', 'cancelled'],
  confirmed: ['cancelled', 'completed'],
  declined: [], cancelled: [], completed: [],
};
// Trip stages, in the order they normally happen.
const LEG_NEXT = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['en_route', 'cancelled', 'no_show'],
  en_route: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed'],
  completed: [], cancelled: [], no_show: [],
};
export const LEG_STATUSES = Object.keys(LEG_NEXT);

const num = (v, what) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new ApiError(404, 'NOT_FOUND', `${what} not found.`); return n; };
const history = (tx, bookingId, legId, from, to, userId, reason) =>
  tx.query('INSERT INTO booking_status_history (booking_id, booking_leg_id, from_status, to_status, changed_by_user_id, reason) VALUES ($1,$2,$3,$4,$5,$6)', [bookingId, legId, from, to, userId, reason || null]);

async function lockBooking(tx, id) {
  const b = (await tx.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [num(id, 'Booking')])).rows[0];
  if (!b) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.');
  return b;
}

export async function setBookingStatus(db, id, to, userId, reason = '') {
  const note = paragraph(reason, { max: 300 });
  if (note === null) throw new ApiError(400, 'VALIDATION', 'That note is too long.');
  return db.tx(async (tx) => {
    const b = await lockBooking(tx, id);
    if (!(BOOKING_NEXT[b.status] || []).includes(to)) throw new ApiError(409, 'BAD_TRANSITION', `A ${b.status} booking cannot be changed to ${to}.`);
    if (to === 'completed') {
      const open = (await tx.query("SELECT 1 FROM booking_legs WHERE booking_id = $1 AND leg_status NOT IN ('completed','cancelled','no_show') LIMIT 1", [b.id])).rows.length;
      if (open) throw new ApiError(409, 'TRIPS_OPEN', 'Mark every trip as completed first.');
    }
    await tx.query('UPDATE bookings SET status = $2, cancelled_at = CASE WHEN $2 = \'cancelled\' THEN now() ELSE cancelled_at END WHERE id = $1', [b.id, to]);
    if (to === 'confirmed') await tx.query("UPDATE booking_legs SET leg_status = 'confirmed' WHERE booking_id = $1 AND leg_status = 'pending'", [b.id]);
    if (to === 'declined' || to === 'cancelled') await tx.query("UPDATE booking_legs SET leg_status = 'cancelled' WHERE booking_id = $1 AND leg_status NOT IN ('completed')", [b.id]);
    await history(tx, b.id, null, b.status, to, userId, note || (to === 'cancelled' ? 'Cancelled by staff' : null));
    return { status: to };
  });
}

export async function setLegStatus(db, bookingId, legNumber, to, userId) {
  return db.tx(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    const leg = (await tx.query('SELECT * FROM booking_legs WHERE booking_id = $1 AND leg_number = $2 FOR UPDATE', [b.id, num(legNumber, 'Trip')])).rows[0];
    if (!leg) throw new ApiError(404, 'NOT_FOUND', 'Trip not found.');
    if (b.status !== 'confirmed') {
      throw new ApiError(409, 'NOT_CONFIRMED', 'Confirm the booking before moving its trips along.');
    }
    if (!(LEG_NEXT[leg.leg_status] || []).includes(to)) throw new ApiError(409, 'BAD_TRANSITION', `A trip that is ${leg.leg_status.replace('_', ' ')} cannot be changed to ${to.replace('_', ' ')}.`);
    if (to === 'en_route' && !leg.driver_id) throw new ApiError(409, 'NO_DRIVER', 'Assign a driver before marking the trip as on the way.');
    await tx.query('UPDATE booking_legs SET leg_status = $2 WHERE id = $1', [leg.id, to]);
    await history(tx, b.id, leg.id, leg.leg_status, to, userId, `Trip ${leg.leg_number}`);
    // When every trip has finished, the booking is complete.
    const rest = (await tx.query("SELECT leg_status FROM booking_legs WHERE booking_id = $1", [b.id])).rows.map((r) => r.leg_status);
    let bookingStatus = b.status;
    if (b.status === 'confirmed' && rest.every((s) => ['completed', 'cancelled', 'no_show'].includes(s)) && rest.some((s) => s === 'completed')) {
      await tx.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [b.id]);
      await history(tx, b.id, null, 'confirmed', 'completed', userId, 'All trips finished');
      bookingStatus = 'completed';
    }
    return { legStatus: to, bookingStatus };
  });
}

/** Assign (or clear, with driverId null) the driver for one trip. Warns when the driver has another trip close by. */
export async function assignDriver(db, bookingId, legNumber, driverId, userId, force = false) {
  return db.tx(async (tx) => {
    const b = await lockBooking(tx, bookingId);
    const leg = (await tx.query('SELECT * FROM booking_legs WHERE booking_id = $1 AND leg_number = $2 FOR UPDATE', [b.id, num(legNumber, 'Trip')])).rows[0];
    if (!leg) throw new ApiError(404, 'NOT_FOUND', 'Trip not found.');
    if (['declined', 'cancelled', 'completed'].includes(b.status) || ['completed', 'cancelled', 'no_show'].includes(leg.leg_status)) throw new ApiError(409, 'CLOSED', 'This trip is closed, so the driver cannot be changed.');
    if (driverId === null) {
      if (leg.leg_status === 'en_route' || leg.leg_status === 'in_progress') throw new ApiError(409, 'TRIP_STARTED', 'The trip has already started, so the driver cannot be removed.');
      await tx.query('UPDATE booking_legs SET driver_id = NULL WHERE id = $1', [leg.id]);
      await history(tx, b.id, leg.id, null, 'driver_removed', userId, `Trip ${leg.leg_number}`);
      return { driver: null, conflicts: [] };
    }
    const d = (await tx.query('SELECT id, full_name, is_active FROM drivers WHERE id = $1', [num(driverId, 'Driver')])).rows[0];
    if (!d) throw new ApiError(404, 'NOT_FOUND', 'Driver not found.');
    if (!d.is_active) throw new ApiError(409, 'DRIVER_INACTIVE', 'That driver is marked inactive.');
    const conflicts = (await tx.query(
      `SELECT b2.reference, l.pickup_at FROM booking_legs l JOIN bookings b2 ON b2.id = l.booking_id
        WHERE l.driver_id = $1 AND l.id <> $2 AND l.leg_status NOT IN ('completed','cancelled','no_show')
          AND abs(extract(epoch FROM (l.pickup_at - $3::timestamptz))) < 7200`, [d.id, leg.id, leg.pickup_at])).rows;
    if (conflicts.length && !force) {
      throw new ApiError(409, 'DRIVER_BUSY', `${d.full_name} already has a trip within 2 hours of this one (${conflicts.map((c) => c.reference).join(', ')}).`, { conflicts: conflicts.map((c) => c.reference).join(',') });
    }
    await tx.query('UPDATE booking_legs SET driver_id = $2 WHERE id = $1', [leg.id, d.id]);
    await history(tx, b.id, leg.id, null, 'driver_assigned', userId, `Trip ${leg.leg_number}: ${d.full_name}`);
    return { driver: { id: d.id, fullName: d.full_name }, conflicts: conflicts.map((c) => c.reference) };
  });
}

export async function setInternalNotes(db, bookingId, notes) {
  const v = paragraph(notes, { max: 1000 });
  if (v === null) throw new ApiError(400, 'VALIDATION', 'That note is too long.');
  const r = await db.query('UPDATE bookings SET notes_internal = $2 WHERE id = $1 RETURNING id', [num(bookingId, 'Booking'), v || null]);
  if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.');
  return { notesInternal: v };
}
