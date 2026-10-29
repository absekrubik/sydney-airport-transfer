-- Drivers are records only (they never log in). A leg can be assigned to one driver.
CREATE TABLE drivers (
  id                   serial PRIMARY KEY,
  full_name            text NOT NULL,
  phone                text NOT NULL,
  email                text NOT NULL DEFAULT '',
  vehicle_category_id  integer REFERENCES vehicle_categories(id) ON DELETE SET NULL,
  vehicle_details      text NOT NULL DEFAULT '',   -- e.g. "White Camry, ABC123"
  notes                text NOT NULL DEFAULT '',
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER drivers_updated BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE booking_legs ADD COLUMN driver_id integer REFERENCES drivers(id) ON DELETE SET NULL;
CREATE INDEX booking_legs_driver_idx ON booking_legs (driver_id, pickup_at);
