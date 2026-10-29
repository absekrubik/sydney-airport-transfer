// Admin management of drivers (records only; drivers do not log in).
import { ApiError, text, paragraph, throwIfErrors, EMAIL_RE } from '../lib/validate.js';

export function parseDriverInput(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {}; const v = {};
  if (!partial || b.fullName !== undefined) { v.fullName = text(b.fullName, { min: 2, max: 80 }); if (!v.fullName) errors.fullName = 'Enter the driver’s name'; }
  if (!partial || b.phone !== undefined) {
    v.phone = text(b.phone, { min: 6, max: 30 });
    if (!v.phone || !/^[0-9+()\-\s]{6,30}$/.test(v.phone)) errors.phone = 'Enter a valid phone number';
  }
  if (b.email !== undefined) { v.email = text(b.email, { max: 120 }); if (v.email === null || (v.email && !EMAIL_RE.test(v.email))) errors.email = 'Enter a valid email'; }
  if (b.vehicleDetails !== undefined) { v.vehicleDetails = text(b.vehicleDetails, { max: 120 }); if (v.vehicleDetails === null) errors.vehicleDetails = 'That is too long'; }
  if (b.notes !== undefined) { v.notes = paragraph(b.notes, { max: 500 }); if (v.notes === null) errors.notes = 'That is too long'; }
  if (b.vehicleCode !== undefined) {
    if (b.vehicleCode === '' || b.vehicleCode === null) v.vehicleCode = null;
    else { v.vehicleCode = text(b.vehicleCode, { min: 1, max: 40 }); if (!v.vehicleCode) errors.vehicleCode = 'Invalid'; }
  }
  if (b.active !== undefined) { if (typeof b.active !== 'boolean') errors.active = 'Invalid'; else v.active = b.active; }
  throwIfErrors(errors);
  return v;
}

const SELECT = `SELECT d.*, vc.code AS vehicle_code, vc.name AS vehicle_name,
  (SELECT count(*)::int FROM booking_legs l WHERE l.driver_id = d.id AND l.leg_status NOT IN ('completed','cancelled','no_show') AND l.pickup_at > now()) AS upcoming
  FROM drivers d LEFT JOIN vehicle_categories vc ON vc.id = d.vehicle_category_id`;
const shape = (r) => ({ id: r.id, fullName: r.full_name, phone: r.phone, email: r.email, vehicleCode: r.vehicle_code, vehicleName: r.vehicle_name, vehicleDetails: r.vehicle_details, notes: r.notes, active: r.is_active, upcoming: r.upcoming });

async function categoryId(db, code) {
  if (code === null || code === undefined) return null;
  const r = await db.query('SELECT id FROM vehicle_categories WHERE code = $1', [code]);
  if (!r.rows.length) throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.', { vehicleCode: 'That vehicle type does not exist' });
  return r.rows[0].id;
}

export async function listDrivers(db) {
  return (await db.query(`${SELECT} ORDER BY d.is_active DESC, lower(d.full_name)`)).rows.map(shape);
}

export async function createDriver(db, v) {
  const cat = await categoryId(db, v.vehicleCode ?? null);
  const id = (await db.query('INSERT INTO drivers (full_name, phone, email, vehicle_category_id, vehicle_details, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [v.fullName, v.phone, v.email || '', cat, v.vehicleDetails || '', v.notes || ''])).rows[0].id;
  return shape((await db.query(`${SELECT} WHERE d.id = $1`, [id])).rows[0]);
}

export async function updateDriver(db, id, v) {
  const sets = []; const vals = [];
  const add = (col, x) => { vals.push(x); sets.push(`${col} = $${vals.length}`); };
  if (v.fullName !== undefined) add('full_name', v.fullName);
  if (v.phone !== undefined) add('phone', v.phone);
  if (v.email !== undefined) add('email', v.email);
  if (v.vehicleDetails !== undefined) add('vehicle_details', v.vehicleDetails);
  if (v.notes !== undefined) add('notes', v.notes);
  if (v.vehicleCode !== undefined) add('vehicle_category_id', await categoryId(db, v.vehicleCode));
  if (v.active !== undefined) add('is_active', v.active);
  if (!sets.length) throw new ApiError(400, 'VALIDATION', 'Nothing to change.');
  vals.push(Number(id));
  const r = await db.query(`UPDATE drivers SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id`, vals);
  if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Driver not found.');
  return shape((await db.query(`${SELECT} WHERE d.id = $1`, [r.rows[0].id])).rows[0]);
}

/** Drivers who have had trips are kept (hidden) so booking history stays correct. */
export async function deleteDriver(db, id) {
  const n = Number(id);
  const d = (await db.query('SELECT id FROM drivers WHERE id = $1', [n])).rows[0];
  if (!d) throw new ApiError(404, 'NOT_FOUND', 'Driver not found.');
  const used = (await db.query('SELECT 1 FROM booking_legs WHERE driver_id = $1 LIMIT 1', [n])).rows.length;
  if (used) throw new ApiError(409, 'IN_USE', 'This driver has been assigned to trips, so they cannot be deleted. Mark them inactive instead.');
  await db.query('DELETE FROM drivers WHERE id = $1', [n]);
}
