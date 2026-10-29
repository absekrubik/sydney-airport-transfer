// Admin management of promo codes. Used codes are never deleted (bookings point to them); they are switched off instead.
import { ApiError, text, throwIfErrors } from '../lib/validate.js';
import { sydneyToUtc } from '../lib/time.js';

const whole = (v, min, max) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
// Dates arrive as plain Sydney calendar days (YYYY-MM-DD): a start means 12:00 am, an end means 11:59 pm, Sydney time.
const when = (v, time) => {
  if (v === null || v === '' || v === undefined) return null;
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? sydneyToUtc(v, time) : null;
  return d ? new Date(d).toISOString() : undefined;
};

export function parsePromoInput(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {}; const v = {};
  if (!partial) {
    v.code = text(b.code, { min: 3, max: 30 })?.toUpperCase();
    if (!v.code || !/^[A-Z0-9_-]+$/.test(v.code)) errors.code = 'Use 3 to 30 letters, numbers, - or _ (no spaces)';
    if (!['percent', 'fixed'].includes(b.type)) errors.type = 'Choose percent or fixed amount'; else v.type = b.type;
  }
  if (!partial || b.value !== undefined) {
    const type = v.type || b.type;
    // Percent is stored as a whole number; a fixed amount is stored in cents.
    v.value = type === 'fixed' ? whole(b.valueCents ?? b.value, 100, 1000000) : whole(b.value, 1, 100);
    if (v.value === null) errors.value = type === 'fixed' ? 'Enter an amount from $1 to $10,000' : 'Enter a percentage from 1 to 100';
  }
  if (b.minFareCents !== undefined) { v.minFareCents = whole(b.minFareCents, 0, 10000000); if (v.minFareCents === null) errors.minFareCents = 'Enter 0 or more'; }
  if (b.maxUses !== undefined) { v.maxUses = b.maxUses === null || b.maxUses === '' ? null : whole(b.maxUses, 1, 1000000); if (v.maxUses === null && b.maxUses !== null && b.maxUses !== '') errors.maxUses = 'Enter a whole number, or leave blank for unlimited'; }
  if (b.validFrom !== undefined) { v.validFrom = when(b.validFrom, '00:00'); if (v.validFrom === undefined) errors.validFrom = 'Enter a valid date'; }
  if (b.validTo !== undefined) { v.validTo = when(b.validTo, '23:59'); if (v.validTo === undefined) errors.validTo = 'Enter a valid date'; }
  if (v.validFrom && v.validTo && v.validTo <= v.validFrom) errors.validTo = 'The end must be after the start';
  if (b.active !== undefined) { if (typeof b.active !== 'boolean') errors.active = 'Invalid'; else v.active = b.active; }
  throwIfErrors(errors);
  return v;
}

const shape = (r) => ({ id: r.id, code: r.code, type: r.type, value: r.value, minFareCents: r.min_fare_cents, maxUses: r.max_uses, uses: r.uses_count, validFrom: r.valid_from, validTo: r.valid_to, active: r.is_active });

export async function listPromos(db) { return (await db.query('SELECT * FROM promotions ORDER BY is_active DESC, created_at DESC, id DESC')).rows.map(shape); }

export async function createPromo(db, v) {
  try {
    const r = await db.query('INSERT INTO promotions (code, type, value, min_fare_cents, max_uses, valid_from, valid_to) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [v.code, v.type, v.value, v.minFareCents ?? 0, v.maxUses ?? null, v.validFrom ?? null, v.validTo ?? null]);
    return shape(r.rows[0]);
  } catch (e) {
    if (/promotions_code_key|duplicate key/i.test(String(e.message))) throw new ApiError(409, 'DUPLICATE', 'That code already exists.', { code: 'That code already exists' });
    throw e;
  }
}

export async function updatePromo(db, id, v) {
  const sets = []; const vals = [];
  const add = (col, x) => { vals.push(x); sets.push(`${col} = $${vals.length}`); };
  if (v.value !== undefined) add('value', v.value);
  if (v.minFareCents !== undefined) add('min_fare_cents', v.minFareCents);
  if (v.maxUses !== undefined) add('max_uses', v.maxUses);
  if (v.validFrom !== undefined) add('valid_from', v.validFrom);
  if (v.validTo !== undefined) add('valid_to', v.validTo);
  if (v.active !== undefined) add('is_active', v.active);
  if (!sets.length) throw new ApiError(400, 'VALIDATION', 'Nothing to change.');
  vals.push(Number(id));
  const r = await db.query(`UPDATE promotions SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  if (!r.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Promo code not found.');
  return shape(r.rows[0]);
}

export async function deletePromo(db, id) {
  const n = Number(id);
  const p = (await db.query('SELECT id, uses_count FROM promotions WHERE id = $1', [n])).rows[0];
  if (!p) throw new ApiError(404, 'NOT_FOUND', 'Promo code not found.');
  const used = p.uses_count > 0 || (await db.query('SELECT 1 FROM bookings WHERE promotion_id = $1 LIMIT 1', [n])).rows.length;
  if (used) throw new ApiError(409, 'IN_USE', 'This code has been used in bookings, so it cannot be deleted. Switch it off instead.');
  await db.query('DELETE FROM promotions WHERE id = $1', [n]);
}
