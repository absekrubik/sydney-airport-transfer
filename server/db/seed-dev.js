// DEVELOPMENT DATA ONLY. Placeholder vehicles, places and fares so the site can be tried before the
// client supplies real ones. Fares are marked is_sample = true and the website says so.
// Coordinates are approximate. Replace all of this with the client's real data before launch.
const VEHICLES = [
  ['sedan', 'Business Sedan', 'Toyota Camry or similar', 3, 3, ['Air conditioning', 'Bottled water', 'Phone charger']],
  ['suv', 'Premium SUV', 'Kia Sorento or similar', 5, 5, ['Extra luggage space', 'Air conditioning', 'Child seat available']],
  ['van', 'Group Van', 'Hyundai Staria or similar', 7, 8, ['Large luggage area', 'Air conditioning', 'Group travel']],
  ['luxury', 'Luxury Sedan', 'Mercedes E-Class or similar', 3, 3, ['Leather seats', 'Complimentary water', 'Chauffeur service']],
];
const AIRPORTS = [
  ['Sydney Airport (SYD) – Domestic Terminal', -33.9335, 151.1830, 900],
  ['Sydney Airport (SYD) – International Terminal', -33.9361, 151.1637, 900],
];
const AREAS = [
  // label, lat, lng, radius, [sedan, suv, van, luxury] fares in cents
  ['Sydney CBD', -33.8688, 151.2093, 2500, [8500, 11000, 14500, 15500]],
  ['Parramatta', -33.8150, 151.0011, 3500, [11000, 14000, 18000, 19500]],
  ['Bondi Beach', -33.8915, 151.2767, 1800, [9000, 11500, 15000, 16500]],
  ['Manly', -33.7969, 151.2874, 2000, [12500, 15500, 19500, 21000]],
  ['North Sydney', -33.8404, 151.2070, 1800, [9500, 12000, 15500, 17000]],
  ['Chatswood', -33.7969, 151.1833, 2200, [11500, 14500, 18500, 20000]],
  ['Darling Harbour', -33.8731, 151.1990, 1200, [8500, 11000, 14500, 15500]],
];

export async function seedDev(db) {
  const has = await db.query('SELECT 1 FROM pricing_rule_sets LIMIT 1');
  if (has.rows.length) return false; // never overwrite real data
  await db.tx(async (tx) => {
    const cat = {};
    for (const [i, [code, name, example, pax, bags, features]] of VEHICLES.entries()) {
      cat[code] = (await tx.query('INSERT INTO vehicle_categories (code, name, example_model, passenger_capacity, luggage_capacity, features, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [code, name, example, pax, bags, JSON.stringify(features), i])).rows[0].id;
    }
    const airportIds = [];
    for (const [i, [label, lat, lng, radius]] of AIRPORTS.entries()) {
      airportIds.push((await tx.query("INSERT INTO locations (label, kind, lat, lng, radius_m, sort_order) VALUES ($1,'airport',$2,$3,$4,$5) RETURNING id", [label, lat, lng, radius, i])).rows[0].id);
    }
    const rs = (await tx.query('INSERT INTO pricing_rule_sets (version_number, is_active, is_sample, return_discount_percent, child_seat_cents) VALUES (1, true, true, 10, 1000) RETURNING id')).rows[0].id;
    for (const [i, [label, lat, lng, radius, fares]] of AREAS.entries()) {
      const areaId = (await tx.query("INSERT INTO locations (label, kind, lat, lng, radius_m, sort_order) VALUES ($1,'area',$2,$3,$4,$5) RETURNING id", [label, lat, lng, radius, 10 + i])).rows[0].id;
      for (const airportId of airportIds) {
        for (const [v, code] of VEHICLES.map((x, idx) => [idx, x[0]])) {
          await tx.query('INSERT INTO fixed_routes (rule_set_id, origin_id, destination_id, vehicle_category_id, fare_cents) VALUES ($1,$2,$3,$4,$5)', [rs, airportId, areaId, cat[code], fares[v]]);
        }
      }
    }
    // Sample distance rates (base, per km, minimum, in cents) so non-fixed trips can be priced in development
    const RATES = { sedan: [1500, 280, 6500], suv: [2000, 340, 8500], van: [2500, 400, 10000], luxury: [3500, 500, 12000] };
    for (const [code, [base, perKm, min]] of Object.entries(RATES)) {
      if (cat[code]) await tx.query('INSERT INTO distance_rates (rule_set_id, vehicle_category_id, base_cents, per_km_cents, min_cents) VALUES ($1,$2,$3,$4,$5)', [rs, cat[code], base, perKm, min]);
    }
    const settings = {
      business: { name: 'Sydney Airport Transfers', abn: '', phone: '', email: '', whatsapp: '', serviceArea: 'Sydney, NSW' },
      payments: { card_online: true, deposit: true, cash_to_driver: true },
      cancellation: { fee_percent: 50 },
      booking: { min_lead_minutes: 180, max_advance_days: 365 },
    };
    for (const [k, v] of Object.entries(settings)) await tx.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, JSON.stringify(v)]);
  });
  return true;
}
