-- Money in and out. One row per payment or refund. Card payments come from Stripe; cash/bank are recorded by staff.
CREATE TABLE payments (
  id                        serial PRIMARY KEY,
  booking_id                integer NOT NULL REFERENCES bookings(id),
  kind                      text NOT NULL CHECK (kind IN ('payment', 'refund')),
  method                    text NOT NULL CHECK (method IN ('card', 'cash', 'bank', 'other')),
  amount_cents              integer NOT NULL CHECK (amount_cents > 0),
  status                    text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
  parent_payment_id         integer REFERENCES payments(id),   -- for a refund: the payment it returns money from
  stripe_session_id         text UNIQUE,
  stripe_payment_intent_id  text,
  stripe_refund_id          text UNIQUE,
  note                      text,
  failure_reason            text,
  created_by_user_id        integer REFERENCES users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments (booking_id);
CREATE INDEX payments_created_idx ON payments (created_at DESC);
CREATE TRIGGER payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stripe may deliver the same event more than once; this makes handling it once-only.
CREATE TABLE stripe_events (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);
