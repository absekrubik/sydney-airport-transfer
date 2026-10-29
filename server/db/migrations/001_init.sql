-- Stage 3 schema. Money is integer cents (AUD). All times are timestamptz (stored as UTC).
-- Plain SQL on purpose: every table and rule is readable here.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ---------- Configuration ----------
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicle_categories (
  id                  serial PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  example_model       text NOT NULL DEFAULT '',
  passenger_capacity  smallint NOT NULL CHECK (passenger_capacity > 0),
  luggage_capacity    smallint NOT NULL CHECK (luggage_capacity >= 0),
  description         text NOT NULL DEFAULT '',
  features            jsonb NOT NULL DEFAULT '[]',
  sort_order          smallint NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Named places we can sell fixed fares for. A map pin within radius_m of a location counts as that place.
CREATE TABLE locations (
  id          serial PRIMARY KEY,
  label       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('airport', 'area')),
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  radius_m    integer NOT NULL CHECK (radius_m > 0),
  sort_order  smallint NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX locations_label_key ON locations (lower(label));

-- Versioned so an old booking can always be explained by the rules it was priced with.
CREATE TABLE pricing_rule_sets (
  id                       serial PRIMARY KEY,
  version_number           integer NOT NULL UNIQUE,
  is_active                boolean NOT NULL DEFAULT false,
  is_sample                boolean NOT NULL DEFAULT false,   -- true = development placeholder fares
  return_discount_percent  smallint NOT NULL DEFAULT 0 CHECK (return_discount_percent BETWEEN 0 AND 100),
  child_seat_cents         integer NOT NULL DEFAULT 0 CHECK (child_seat_cents >= 0),
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pricing_rule_sets_one_active ON pricing_rule_sets (is_active) WHERE is_active;

-- One row per direction-agnostic pair: the engine matches origin->destination and the reverse.
CREATE TABLE fixed_routes (
  id                    serial PRIMARY KEY,
  rule_set_id           integer NOT NULL REFERENCES pricing_rule_sets(id) ON DELETE CASCADE,
  origin_id             integer NOT NULL REFERENCES locations(id),
  destination_id        integer NOT NULL REFERENCES locations(id),
  vehicle_category_id   integer NOT NULL REFERENCES vehicle_categories(id),
  fare_cents            integer NOT NULL CHECK (fare_cents > 0),
  is_active             boolean NOT NULL DEFAULT true,
  UNIQUE (rule_set_id, origin_id, destination_id, vehicle_category_id),
  CHECK (origin_id <> destination_id)
);

CREATE TABLE promotions (
  id              serial PRIMARY KEY,
  code            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('percent', 'fixed')),
  value           integer NOT NULL CHECK (value > 0),
  min_fare_cents  integer NOT NULL DEFAULT 0,
  max_uses        integer,
  uses_count      integer NOT NULL DEFAULT 0,
  valid_from      timestamptz,
  valid_to        timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX promotions_code_key ON promotions (lower(code));

-- ---------- Staff (owner and staff only; drivers never log in) ----------
CREATE TABLE users (
  id                  serial PRIMARY KEY,
  email               text NOT NULL,
  password_hash       text NOT NULL,
  role                text NOT NULL CHECK (role IN ('owner', 'staff')),
  full_name           text NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Server-side sessions. Only a hash of the cookie value is stored.
CREATE TABLE sessions (
  id            bigserial PRIMARY KEY,
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  csrf_token    text NOT NULL,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ---------- Customers and bookings ----------
CREATE TABLE customers (
  id               serial PRIMARY KEY,
  full_name        text NOT NULL,
  email            text NOT NULL,
  phone            text NOT NULL,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_email_key ON customers (lower(email));
CREATE TRIGGER customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bookings (
  id                      serial PRIMARY KEY,
  reference               text NOT NULL UNIQUE,
  customer_id             integer NOT NULL REFERENCES customers(id),
  trip_type               text NOT NULL CHECK (trip_type IN ('one_way', 'return')),
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'completed')),
  payment_status          text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'partially_paid', 'failed', 'refunded', 'partially_refunded')),
  payment_preference      text NOT NULL CHECK (payment_preference IN ('card_online', 'deposit', 'cash_to_driver')),
  passengers              smallint NOT NULL CHECK (passengers > 0),
  luggage                 smallint NOT NULL CHECK (luggage >= 0),
  child_seats             smallint NOT NULL DEFAULT 0 CHECK (child_seats >= 0),
  vehicle_category_id     integer NOT NULL REFERENCES vehicle_categories(id),
  flight_number           text,
  notes_customer          text,
  notes_internal          text,
  quoted_total_cents      integer NOT NULL CHECK (quoted_total_cents >= 0),
  gst_cents               integer NOT NULL CHECK (gst_cents >= 0),
  discount_cents          integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  quote_breakdown         jsonb NOT NULL,
  pricing_rule_set_id     integer NOT NULL REFERENCES pricing_rule_sets(id),
  pricing_method          text NOT NULL DEFAULT 'fixed' CHECK (pricing_method IN ('fixed', 'distance')),
  promotion_id            integer REFERENCES promotions(id),
  idempotency_key         text NOT NULL UNIQUE,
  view_token_hash         text NOT NULL,
  cancellation_fee_cents  integer NOT NULL DEFAULT 0,
  cancelled_at            timestamptz,
  source                  text NOT NULL DEFAULT 'website',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_status_idx ON bookings (status, created_at DESC);
CREATE INDEX bookings_customer_idx ON bookings (customer_id);
CREATE TRIGGER bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per journey; a return booking has two.
CREATE TABLE booking_legs (
  id               serial PRIMARY KEY,
  booking_id       integer NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  leg_number       smallint NOT NULL,
  leg_type         text NOT NULL CHECK (leg_type IN ('outbound', 'return')),
  pickup_address   text NOT NULL,
  pickup_lat       double precision,
  pickup_lng       double precision,
  dropoff_address  text NOT NULL,
  dropoff_lat      double precision,
  dropoff_lng      double precision,
  pickup_at        timestamptz NOT NULL,
  leg_status       text NOT NULL DEFAULT 'pending' CHECK (leg_status IN ('pending', 'confirmed', 'en_route', 'in_progress', 'completed', 'cancelled', 'no_show')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, leg_number)
);
CREATE INDEX booking_legs_pickup_idx ON booking_legs (pickup_at);
CREATE TRIGGER booking_legs_updated BEFORE UPDATE ON booking_legs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE booking_status_history (
  id                  bigserial PRIMARY KEY,
  booking_id          integer NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  booking_leg_id      integer REFERENCES booking_legs(id) ON DELETE CASCADE,
  from_status         text,
  to_status           text NOT NULL,
  changed_by_user_id  integer REFERENCES users(id),
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_status_history_booking_idx ON booking_status_history (booking_id);

CREATE TABLE contact_messages (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL,
  phone         text,
  topic         text NOT NULL DEFAULT 'general',
  message       text NOT NULL,
  trip_details  jsonb,
  is_handled    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    integer REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
