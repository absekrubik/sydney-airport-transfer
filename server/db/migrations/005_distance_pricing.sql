-- Trips that are not on a fixed route are priced by driving distance: base + per-km, with a minimum fare.
-- Rates belong to a pricing rule set, so old bookings can always be explained.
ALTER TABLE pricing_rule_sets ADD COLUMN distance_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE distance_rates (
  rule_set_id          integer NOT NULL REFERENCES pricing_rule_sets(id) ON DELETE CASCADE,
  vehicle_category_id  integer NOT NULL REFERENCES vehicle_categories(id) ON DELETE CASCADE,
  base_cents           integer NOT NULL CHECK (base_cents >= 0),
  per_km_cents         integer NOT NULL CHECK (per_km_cents > 0),
  min_cents            integer NOT NULL CHECK (min_cents > 0),
  PRIMARY KEY (rule_set_id, vehicle_category_id)
);

-- Driving distances already looked up, so the same trip is priced the same way when it is booked
-- and we do not pay the routing service twice.
CREATE TABLE route_cache (
  key         text PRIMARY KEY,
  distance_m  integer NOT NULL,
  duration_s  integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
