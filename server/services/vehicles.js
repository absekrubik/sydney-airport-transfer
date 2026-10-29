// Admin management of vehicle types: add, edit, hide/show and delete.
import { ApiError, text, throwIfErrors } from '../lib/validate.js';

const whole = (v, min, max) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export function parseVehicleInput(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {}; const value = {};
  if (!partial || b.name !== undefined) { value.name = text(b.name, { min: 2, max: 60 }); if (!value.name) errors.name = 'Enter a name (2 to 60 characters)'; }
  if (!partial || b.example !== undefined) { value.example = text(b.example, { max: 80 }); if (value.example === null) errors.example = 'That is too long'; }
  if (!partial || b.passengers !== undefined) { value.passengers = whole(b.passengers, 1, 60); if (value.passengers === null) errors.passengers = 'Enter 1 to 60 passengers'; }
  if (!partial || b.luggage !== undefined) { value.luggage = whole(b.luggage, 0, 60); if (value.luggage === null) errors.luggage = 'Enter 0 to 60 bags'; }
  if (!partial || b.features !== undefined) {
    const raw = Array.isArray(b.features) ? b.features : typeof b.features === 'string' ? b.features.split(/[\n,]/) : [];
    const list = raw.map((f) => text(f, { max: 60 })).filter(Boolean);
    if (list.length > 10 || raw.some((f) => typeof f !== 'string')) errors.features = 'Up to 10 features, each under 60 characters';
    value.features = list;
  }
  if (b.active !== undefined) { if (typeof b.active !== 'boolean') errors.active = 'Invalid'; else value.active = b.active; }
  if (!partial) {
    if (b.copyFaresFrom !== undefined && b.copyFaresFrom !== '') { value.copyFaresFrom = text(b.copyFaresFrom, { max: 40 }); if (!value.copyFaresFrom) errors.copyFaresFrom = 'Invalid'; }
    if (b.farePercent !== undefined && b.farePercent !== '') { value.farePercent = whole(b.farePercent, 10, 500); if (value.farePercent === null) errors.farePercent = 'Enter a percentage from 10 to 500'; }
  }
  throwIfErrors(errors);
  return value;
}

const shape = (r) => ({ code: r.code, name: r.name, example: r.example_model, passengers: r.passenger_capacity, luggage: r.luggage_capacity, features: r.features || [], active: r.is_active });

export async function listAllVehicles(db) {
  return (await db.query('SELECT * FROM vehicle_categories ORDER BY sort_order, id')).rows.map(shape);
}

async function uniqueCode(tx, name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'vehicle';
  for (let i = 1; i < 100; i++) {
    const code = i === 1 ? base : `${base}-${i}`;
    if (!(await tx.query('SELECT 1 FROM vehicle_categories WHERE code = $1', [code])).rows.length) return code;
  }
  throw new ApiError(409, 'CODE_TAKEN', 'Please choose a different name.');
}

export async function createVehicle(db, input) {
  return db.tx(async (tx) => {
    const code = await uniqueCode(tx, input.name);
    const next = (await tx.query('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM vehicle_categories')).rows[0].n;
    const row = (await tx.query(
      `INSERT INTO vehicle_categories (code, name, example_model, passenger_capacity, luggage_capacity, features, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [code, input.name, input.example || '', input.passengers, input.luggage, JSON.stringify(input.features || []), next])).rows[0];
    let copied = 0;
    if (input.copyFaresFrom) {
      const src = (await tx.query('SELECT id FROM vehicle_categories WHERE code = $1', [input.copyFaresFrom])).rows[0];
      if (!src) throw new ApiError(400, 'VALIDATION', 'Please check the highlighted fields.', { copyFaresFrom: 'That vehicle does not exist' });
      const pct = input.farePercent ?? 100;
      const r = await tx.query(
        `INSERT INTO fixed_routes (rule_set_id, origin_id, destination_id, vehicle_category_id, fare_cents)
         SELECT rule_set_id, origin_id, destination_id, $1, (round(fare_cents * $3 / 100.0 / 100.0) * 100)::int
         FROM fixed_routes WHERE vehicle_category_id = $2 RETURNING id`, [row.id, src.id, pct]);
      copied = r.rows.length;
      // The same relationship for per-km rates (current pricing version only)
      await tx.query(
        `INSERT INTO distance_rates (rule_set_id, vehicle_category_id, base_cents, per_km_cents, min_cents)
         SELECT d.rule_set_id, $1, (round(d.base_cents * $3 / 100.0 / 100.0) * 100)::int, GREATEST(1, round(d.per_km_cents * $3 / 100.0))::int, GREATEST(100, round(d.min_cents * $3 / 100.0 / 100.0) * 100)::int
           FROM distance_rates d JOIN pricing_rule_sets rs ON rs.id = d.rule_set_id AND rs.is_active WHERE d.vehicle_category_id = $2
         ON CONFLICT DO NOTHING`, [row.id, src.id, pct]);
    }
    return { vehicle: shape(row), faresCopied: copied };
  });
}

export async function updateVehicle(db, code, input) {
  const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (input.name !== undefined) add('name', input.name);
  if (input.example !== undefined) add('example_model', input.example);
  if (input.passengers !== undefined) add('passenger_capacity', input.passengers);
  if (input.luggage !== undefined) add('luggage_capacity', input.luggage);
  if (input.features !== undefined) add('features', JSON.stringify(input.features));
  if (input.active !== undefined) add('is_active', input.active);
  if (!sets.length) throw new ApiError(400, 'VALIDATION', 'Nothing to change.');
  vals.push(code);
  const r = await db.query(`UPDATE vehicle_categories SET ${sets.join(', ')}, updated_at = now() WHERE code = $${vals.length} RETURNING *`, vals);
  if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', 'That vehicle type does not exist.');
  return shape(r.rows[0]);
}

/** Deleting is only allowed when no booking used the vehicle; otherwise it must be hidden to keep history intact. */
export async function deleteVehicle(db, code) {
  return db.tx(async (tx) => {
    const v = (await tx.query('SELECT id FROM vehicle_categories WHERE code = $1', [code])).rows[0];
    if (!v) throw new ApiError(404, 'NOT_FOUND', 'That vehicle type does not exist.');
    const used = (await tx.query('SELECT 1 FROM bookings WHERE vehicle_category_id = $1 LIMIT 1', [v.id])).rows.length;
    if (used) throw new ApiError(409, 'IN_USE', 'This vehicle has been used in bookings, so it cannot be deleted. Hide it instead and it will disappear from the website.');
    await tx.query('DELETE FROM fixed_routes WHERE vehicle_category_id = $1', [v.id]);
    await tx.query('DELETE FROM vehicle_categories WHERE id = $1', [v.id]);
  });
}
