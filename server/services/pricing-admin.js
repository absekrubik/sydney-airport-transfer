// Admin editing of fares and pricing rules. Every save creates a NEW version of the rule set, so an old
// booking can always be explained by the fares and rules that were live when it was made.
import { ApiError, throwIfErrors } from '../lib/validate.js';

const whole = (v, min, max) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export async function getPricingAdmin(db, settings, { routingReady = false } = {}) {
  const rs = (await db.query('SELECT * FROM pricing_rule_sets WHERE is_active LIMIT 1')).rows[0];
  if (!rs) throw new ApiError(503, 'NO_PRICING', 'Pricing is not set up yet.');
  const [locs, cats, routes, rates] = await Promise.all([
    db.query('SELECT id, label, kind FROM locations WHERE is_active ORDER BY sort_order, id'),
    db.query('SELECT id, code, name FROM vehicle_categories WHERE is_active ORDER BY sort_order, id'),
    db.query('SELECT origin_id, destination_id, vehicle_category_id, fare_cents FROM fixed_routes WHERE rule_set_id = $1 AND is_active', [rs.id]),
    db.query('SELECT vehicle_category_id, base_cents, per_km_cents, min_cents FROM distance_rates WHERE rule_set_id = $1', [rs.id]),
  ]);
  const code = new Map(cats.rows.map((c) => [c.id, c.code]));
  const label = new Map(locs.rows.map((l) => [l.id, l]));
  // Rows are airport <-> area pairs (plus any other pair that already has a fare).
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const pairs = new Map();
  for (const a of locs.rows.filter((l) => l.kind === 'airport')) for (const b of locs.rows.filter((l) => l.kind !== 'airport')) pairs.set(key(a.id, b.id), [a.id, b.id]);
  for (const r of routes.rows) if (!pairs.has(key(r.origin_id, r.destination_id))) pairs.set(key(r.origin_id, r.destination_id), [r.origin_id, r.destination_id]);
  const fares = {};
  for (const r of routes.rows) if (code.has(r.vehicle_category_id)) fares[`${key(r.origin_id, r.destination_id)}|${code.get(r.vehicle_category_id)}`] = r.fare_cents;
  return {
    version: rs.version_number, isSample: rs.is_sample,
    returnDiscountPercent: rs.return_discount_percent, childSeatCents: rs.child_seat_cents,
    cancellationPercent: settings.cancellation.fee_percent,
    vehicles: cats.rows.map((c) => ({ code: c.code, name: c.name })),
    routes: [...pairs.entries()].map(([k, [a, b]]) => ({ key: k, from: label.get(a).label, to: label.get(b).label, fromId: a, toId: b })),
    fares,
    distanceEnabled: rs.distance_enabled, routingReady,
    rates: Object.fromEntries(rates.rows.filter((r) => code.has(r.vehicle_category_id)).map((r) => [code.get(r.vehicle_category_id), { baseCents: r.base_cents, perKmCents: r.per_km_cents, minCents: r.min_cents }])),
  };
}

export function parsePricingInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {}; const v = { fares: [] };
  if (b.returnDiscountPercent !== undefined) { v.returnDiscountPercent = whole(b.returnDiscountPercent, 0, 100); if (v.returnDiscountPercent === null) errors.returnDiscountPercent = 'Enter 0 to 100'; }
  if (b.childSeatCents !== undefined) { v.childSeatCents = whole(b.childSeatCents, 0, 100000); if (v.childSeatCents === null) errors.childSeatCents = 'Enter an amount from $0 to $1,000'; }
  if (b.cancellationPercent !== undefined) { v.cancellationPercent = whole(b.cancellationPercent, 0, 100); if (v.cancellationPercent === null) errors.cancellationPercent = 'Enter 0 to 100'; }
  if (b.distanceEnabled !== undefined) { if (typeof b.distanceEnabled !== 'boolean') errors.distanceEnabled = 'Choose on or off'; else v.distanceEnabled = b.distanceEnabled; }
  v.rates = [];
  if (b.rates !== undefined) {
    if (!Array.isArray(b.rates) || b.rates.length > 50) errors.rates = 'Too many changes at once';
    else b.rates.forEach((r, i) => {
      if (typeof r?.vehicle === 'string' && r.baseCents === null && r.perKmCents === null && r.minCents === null) { v.rates.push({ vehicle: r.vehicle, remove: true }); return; } // all boxes cleared
      const base = whole(r?.baseCents, 0, 100000); const perKm = whole(r?.perKmCents, 1, 5000); const min = whole(r?.minCents, 100, 1000000);
      if (typeof r?.vehicle !== 'string' || base === null || perKm === null || min === null) errors[`rate${i}`] = 'Check the base fee ($0 to $1,000), the price per km ($0.01 to $50) and the minimum fare ($1 to $10,000)';
      else v.rates.push({ vehicle: r.vehicle, baseCents: base, perKmCents: perKm, minCents: min });
    });
  }
  if (b.fares !== undefined) {
    if (!Array.isArray(b.fares) || b.fares.length > 500) errors.fares = 'Too many changes at once';
    else b.fares.forEach((f, i) => {
      const cents = f?.cents === null ? null : whole(f?.cents, 100, 5000000);
      const from = whole(f?.fromId, 1, 1e9); const to = whole(f?.toId, 1, 1e9);
      if (!from || !to || from === to || typeof f?.vehicle !== 'string' || (f.cents !== null && cents === null)) errors[`fare${i}`] = 'Fares must be between $1 and $50,000';
      else v.fares.push({ fromId: from, toId: to, vehicle: f.vehicle, cents });
    });
  }
  throwIfErrors(errors);
  return v;
}

export async function savePricing(db, input) {
  return db.tx(async (tx) => {
    const old = (await tx.query('SELECT * FROM pricing_rule_sets WHERE is_active FOR UPDATE')).rows[0];
    if (!old) throw new ApiError(503, 'NO_PRICING', 'Pricing is not set up yet.');
    const cats = new Map((await tx.query('SELECT id, code FROM vehicle_categories')).rows.map((c) => [c.code, c.id]));
    const locs = new Set((await tx.query('SELECT id FROM locations')).rows.map((l) => l.id));
    for (const f of input.fares) if (!cats.has(f.vehicle) || !locs.has(f.fromId) || !locs.has(f.toId)) throw new ApiError(400, 'VALIDATION', 'One of the fares refers to a vehicle or place that does not exist.');
    const ver = (await tx.query('SELECT max(version_number) + 1 AS n FROM pricing_rule_sets')).rows[0].n;
    await tx.query('UPDATE pricing_rule_sets SET is_active = false WHERE id = $1', [old.id]);
    const created = (await tx.query(
      'INSERT INTO pricing_rule_sets (version_number, is_active, is_sample, return_discount_percent, child_seat_cents, distance_enabled) VALUES ($1, true, false, $2, $3, $4) RETURNING id',
      [ver, input.returnDiscountPercent ?? old.return_discount_percent, input.childSeatCents ?? old.child_seat_cents, input.distanceEnabled ?? old.distance_enabled])).rows[0];
    await tx.query(
      `INSERT INTO distance_rates (rule_set_id, vehicle_category_id, base_cents, per_km_cents, min_cents)
       SELECT $1, vehicle_category_id, base_cents, per_km_cents, min_cents FROM distance_rates WHERE rule_set_id = $2`, [created.id, old.id]);
    for (const r of input.rates) {
      if (!cats.has(r.vehicle)) throw new ApiError(400, 'VALIDATION', 'One of the rates refers to a vehicle that does not exist.');
      if (r.remove) { await tx.query('DELETE FROM distance_rates WHERE rule_set_id = $1 AND vehicle_category_id = $2', [created.id, cats.get(r.vehicle)]); continue; }
      await tx.query(
        `INSERT INTO distance_rates (rule_set_id, vehicle_category_id, base_cents, per_km_cents, min_cents) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (rule_set_id, vehicle_category_id) DO UPDATE SET base_cents = EXCLUDED.base_cents, per_km_cents = EXCLUDED.per_km_cents, min_cents = EXCLUDED.min_cents`,
        [created.id, cats.get(r.vehicle), r.baseCents, r.perKmCents, r.minCents]);
    }
    await tx.query(
      `INSERT INTO fixed_routes (rule_set_id, origin_id, destination_id, vehicle_category_id, fare_cents, is_active)
       SELECT $1, origin_id, destination_id, vehicle_category_id, fare_cents, is_active FROM fixed_routes WHERE rule_set_id = $2`, [created.id, old.id]);
    for (const f of input.fares) {
      const vid = cats.get(f.vehicle);
      // Routes are stored once per pair, in either direction.
      await tx.query(
        `DELETE FROM fixed_routes WHERE rule_set_id = $1 AND vehicle_category_id = $2
           AND ((origin_id = $3 AND destination_id = $4) OR (origin_id = $4 AND destination_id = $3))`, [created.id, vid, f.fromId, f.toId]);
      if (f.cents !== null) await tx.query('INSERT INTO fixed_routes (rule_set_id, origin_id, destination_id, vehicle_category_id, fare_cents) VALUES ($1,$2,$3,$4,$5)', [created.id, f.fromId, f.toId, vid, f.cents]);
    }
    if (input.cancellationPercent !== undefined) {
      await tx.query(`INSERT INTO settings (key, value) VALUES ('cancellation', $1::jsonb)
                      ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value`, [JSON.stringify({ fee_percent: input.cancellationPercent })]);
    }
    return { version: ver };
  });
}
