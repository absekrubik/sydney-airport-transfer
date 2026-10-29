# Airport Transfer Booking & Management System — Stage 1: Planning

Status: APPROVED (technical choices confirmed). Stage 2 in progress.

## Confirmed client answers (these override anything below)

- **Service area:** Sydney only. Distance pricing applies only inside a configured Sydney service area; anything else is "request a manual quote".
- **Payments:** online card, pay the driver, and deposit are all supported; owner can switch each on/off in settings.
- **Cancellation:** free until the driver is marked **"en route"**. After that, a configurable **percentage of the total fare** is charged. The percentage is stored in `settings` (`cancellation_fee_percent`); the client has not yet told us the value, so it is a placeholder to confirm. New leg status `en_route` triggers the fee. The customer sees the fee before confirming a cancellation.
- **Extras:** tolls, parking, child seats and waiting time are separate line items.
- **Drivers:** no driver logins. The `driver` role and driver portal are removed; owner/staff update trip status (including "en route").
- **GST:** prices are GST-inclusive. Quotes/receipts show the GST portion (1/11 of total) and the business ABN (client to supply).
- **Technical stack confirmed:** PostgreSQL, `pg` + plain SQL, Google Maps, Stripe (test mode), guest bookings, transactional email behind a swappable module.

---

## 0. Decisions I need you to confirm

| # | Decision | My recommendation | Why |
|---|----------|-------------------|-----|
| 1 | Database | **PostgreSQL** | Has "exclusion constraints" that let the database itself refuse overlapping driver/vehicle assignments. MySQL cannot do this natively, so you would rely on code alone. |
| 2 | DB access | **`pg` library + plain SQL files** (migrations with `node-pg-migrate`) | No ORM to learn. You can read every query. Easier to maintain yourself. |
| 3 | Maps | **Google Maps Platform** (Places Autocomplete + Routes API) | Best Australian address coverage. Mapbox is a valid alternative. |
| 4 | Payments | **Stripe** (test mode first) | Available in Australia, supports PaymentIntents, webhooks, refunds. Client must complete Stripe account verification before live use. |
| 5 | Email | **Resend, Postmark or SendGrid** behind one small `mailer` module | Swappable by changing an environment variable. |
| 6 | Admin login | Server-side **session cookie** (httpOnly, Secure, SameSite) stored in the database | Simpler and safer than JWTs in browser storage for a plain-JS admin panel. |
| 7 | Staff accounts | Roles: `owner`, `staff` (no driver logins) | Confirmed: drivers do not log in. |
| 8 | Hosting | Any Node host + managed PostgreSQL in an **Australian region** (e.g. AWS Sydney) | Customer data stays in Australia; helps with Privacy Act expectations. |
| 9 | Time zones | Store all times as **UTC**, display in the booking's local zone (e.g. `Australia/Sydney`) | Avoids daylight-saving bugs. |
| 10 | Money | Store as **integer cents** + currency `AUD` | Avoids floating-point rounding errors. |
| 11 | GST | Ask the client if prices are GST-inclusive and whether they are GST-registered | Affects receipts and reports. |

Questions for the client (these change the design):
1. Which airports and service areas exactly? (Confirms which routes can be sold.)
2. Is payment online, pay-the-driver, deposit, or all three?
3. Cancellation policy (free until X hours? fee after?).
4. Are meet-and-greet, waiting time, child seats, tolls, parking charged separately?
5. Does the owner want drivers to log in, or only the owner/staff?
6. Does the owner want customer accounts, or guest bookings only? (Plan assumes **guest bookings** with a secure link to view a booking.)

---

## 1. Architecture (in plain language)

```
Browser (HTML + CSS + vanilla JS)
        │  fetch() JSON over HTTPS
        ▼
Express server (Node.js)
  routes → validators → controllers → services → database
        │                                  │
        │                                  ├── Google Maps (distance, autocomplete)
        │                                  ├── Stripe (payments + webhooks)
        │                                  └── Email provider
        ▼
PostgreSQL
```

Layers and why they exist:
- **Routes**: map a URL to a function. No logic.
- **Validators**: check incoming data (types, lengths, formats) before anything else runs.
- **Controllers**: read the request, call services, send the response.
- **Services**: the business rules (pricing, availability, booking creation). This is where most of your maintenance happens, and it is the easiest part to test.
- **Database module**: one place that opens connections and runs transactions.

Express serves the `public/` and `admin/` folders as static files and exposes the API under `/api`. One server, one deployment. Admin API lives under `/api/admin` and every route there requires an authenticated session.

Key rules:
- The server is the source of truth. The browser can show a fare, but the server **recalculates** it on submit and ignores any price sent by the browser.
- Anything involving money, availability or status changes happens inside a **database transaction**.
- Secrets live only in `.env` on the server.

---

## 2. Proposed folder structure

```
airport-transfer-system/
├── public/                    # customer-facing site
│   ├── index.html  services.html  fleet.html  routes.html
│   ├── about.html  contact.html  booking.html  confirmation.html
│   ├── robots.txt  sitemap.xml
│   └── assets/
│       ├── css/   (tokens.css, base.css, components.css, pages/*.css)
│       ├── js/    (api.js, booking-form.js, fare-quote.js, maps.js, ui/*.js, pages/*.js)
│       └── images/
├── admin/
│   ├── login.html  dashboard.html  bookings.html  booking-details.html
│   ├── drivers.html  vehicles.html  pricing.html  customers.html
│   ├── payments.html  promotions.html  reports.html  settings.html
│   └── assets/ (css/, js/)    # admin-only styles and scripts
├── server/
│   ├── app.js                 # builds the Express app
│   ├── server.js              # starts listening
│   ├── config/                # env loading, constants
│   ├── db/                    # pool.js, transaction helper
│   ├── routes/                # public.routes.js, admin.routes.js, webhooks.routes.js
│   ├── controllers/
│   ├── middleware/            # auth, csrf, rateLimit, errorHandler, upload
│   ├── validators/            # zod schemas
│   ├── services/
│   │   ├── pricing.service.js
│   │   ├── booking.service.js
│   │   ├── availability.service.js
│   │   ├── payment.service.js
│   │   ├── notification.service.js
│   │   ├── maps.service.js
│   │   └── report.service.js
│   ├── jobs/                  # reminders, review requests (scheduled)
│   └── utils/                 # references, money, dates
├── uploads/                   # vehicle photos (outside public; served via controlled route)
├── database/
│   ├── migrations/
│   └── seed/                  # clearly labelled fictional development data
├── tests/                     # unit + integration
├── docs/                      # handover guide, deployment notes
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

Suggested packages: `express`, `pg`, `node-pg-migrate`, `zod` (validation), `argon2` (password hashing), `express-session` + `connect-pg-simple`, `helmet`, `express-rate-limit`, `csurf` replacement or a small double-submit CSRF middleware, `multer` + `sharp` (uploads), `stripe`, `nodemailer` or provider SDK, `pino` (logging), `node-cron`, `vitest` or `node:test` + `supertest`.

---

## 3. Database schema

Conventions: every table has `id`, `created_at`, `updated_at`. Money in cents. Times in `timestamptz`.

### Relationship overview

```
users ──< (staff/drivers login)            customers ──< bookings ──< booking_legs ──< booking_assignments >── drivers
                                                │             │                              └──────────────── vehicles
                                                │             └──< booking_status_history
                                                ├──< payments
                                                ├──< notifications
                                                ├──> promotions (applied code)
                                                └──> referrals
pricing_rules, fixed_routes, surcharges, settings  (configuration, versioned)
```

### Tables

**users** — people who log in
`id, email (unique), password_hash, role (owner|staff), full_name, is_active, failed_login_count, locked_until, last_login_at`

**customers**
`id, full_name, email, phone, referral_code (unique), marketing_opt_in, created_at`
Index on `lower(email)`. Guest bookings create or re-use a customer by email.

**drivers**
`id, full_name, phone, email, licence_number_encrypted, licence_expiry, accreditation_number, accreditation_expiry, status (active|inactive), notes`
Sensitive fields encrypted at the application level.

**driver_availability** — weekly pattern and exceptions
`id, driver_id, weekday (nullable), start_time, end_time, exception_date (nullable), is_available`

**vehicles**
`id, category (sedan|suv|van|luxury|minibus), make, model, year, registration (unique), colour, passenger_capacity, luggage_capacity, features (jsonb), photo_path, status (active|maintenance|inactive), description, sort_order`

**vehicle_categories** (what customers pick; a category can have many vehicles)
`id, code, name, passenger_capacity, luggage_capacity, description, photo_path`
Customers choose a **category**; the owner assigns a specific vehicle later.

**pricing_rule_sets** — versioning so old quotes stay explainable
`id, version_number, is_active, effective_from, created_by`

**fixed_routes**
`id, rule_set_id, origin_label, origin_place_id/geo, destination_label, destination_place_id/geo, match_radius_m, vehicle_category_id, fare_cents, is_active`

**distance_rates**
`id, rule_set_id, vehicle_category_id, base_fare_cents, per_km_cents, minimum_fare_cents, free_km (optional), return_discount_percent, waiting_per_min_cents, free_waiting_minutes, is_active`

**surcharges**
`id, rule_set_id, code, label, type (flat|percent), amount, applies_when (night|public_holiday|child_seat|toll|parking|extra_stop|manual), is_active`

**promotions**
`id, code (unique), type (percent|fixed), value, min_fare_cents, max_uses, uses_count, per_customer_limit, valid_from, valid_to, is_active`

**bookings**
`id, reference (unique, e.g. AT-7K3Q9M), customer_id, trip_type (one_way|return), status, payment_status, passengers, luggage, vehicle_category_id, flight_number, child_seats, notes_customer, notes_internal, quoted_total_cents, quote_breakdown (jsonb), pricing_rule_set_id, pricing_method (fixed|distance), promotion_id, referral_id, source, idempotency_key (unique), view_token_hash, revised_fare_cents (nullable), revised_fare_status (none|awaiting_customer|accepted|rejected)`

**booking_legs** — one row per journey (return = 2 rows)
`id, booking_id, leg_number, leg_type (outbound|return), pickup_address, pickup_lat, pickup_lng, pickup_place_id, dropoff_address, dropoff_lat, dropoff_lng, dropoff_place_id, pickup_at (timestamptz), distance_m, duration_s, leg_status (pending|confirmed|en_route|in_progress|completed|cancelled|no_show)`

**booking_assignments**
`id, booking_leg_id, driver_id, vehicle_id, window (tstzrange: pickup minus buffer to pickup plus duration plus buffer), assigned_by, assigned_at, is_active`
Constraints (this is the safety net):
- `EXCLUDE USING gist (driver_id WITH =, window WITH &&) WHERE (is_active)`
- `EXCLUDE USING gist (vehicle_id WITH =, window WITH &&) WHERE (is_active)`

**payments**
`id, booking_id, kind (payment|deposit|refund), method (card_online|cash_to_driver|bank_transfer), amount_cents, currency, status (pending|succeeded|failed|refunded|partially_refunded), provider (stripe|manual), provider_payment_intent_id (unique), provider_refund_id, recorded_by, failure_reason, paid_at`
`stripe_events` table (`event_id` unique) records processed webhooks to prevent double-processing.

**booking_status_history**
`id, booking_id, booking_leg_id (nullable), from_status, to_status, changed_by_user_id, reason, created_at`

**referrals**
`id, referrer_customer_id, referred_customer_id, booking_id, status (pending|qualified|rewarded|rejected), reward_cents, reason_rejected`

**loyalty_ledger** (phase 5)
`id, customer_id, booking_id, points_or_cents, reason`

**notifications**
`id, booking_id, customer_id, channel (email|whatsapp|sms), template, to_address, status (queued|sent|failed), provider_message_id, error, attempts, sent_at`

**settings**
`key, value (jsonb)` — business name, ABN, contact details, cancellation policy, scheduling buffer minutes, payment options, GST flag, currency, WhatsApp number.

**audit_log**
`id, user_id, action, entity, entity_id, before (jsonb), after (jsonb), ip, created_at`

### Statuses (kept separate on purpose)
- Booking status: `pending → confirmed | declined`, then `confirmed → completed | cancelled`. Leg status tracks the trip itself.
- Payment status: `unpaid | pending | paid | partially_paid | failed | refunded | partially_refunded`.

---

## 4. Workflows

### 4.1 Customer workflow
1. Customer enters pickup, destination (Google autocomplete), date/time, trip type, passengers, luggage.
2. Browser calls `POST /api/quotes`. Server validates, finds a **fixed route** match, otherwise gets distance from Google and applies **distance pricing**. Returns an itemised quote per vehicle category and a signed quote token (valid ~15 min).
3. Customer picks a vehicle, fills in contact details, optional promo code, payment choice.
4. Browser sends `POST /api/bookings` with the quote token and an idempotency key. Server re-checks everything, re-prices, saves booking + legs + status history in **one transaction**, status `pending`.
5. Customer lands on `confirmation.html?ref=...&t=<token>` showing real data from the server. Email "request received" is sent.
6. When the owner confirms, customer gets email. If online payment is chosen, email contains a secure pay link. Payment uses Stripe; the **webhook** marks it paid, never the browser redirect.
7. Customer receives assignment details, a reminder before the trip, and later a review request.
8. If the owner changes the fare, customer receives an approval link and must accept before the booking proceeds.

### 4.2 Administrator workflow
1. Log in → dashboard shows pending bookings and today's trips.
2. Open a pending booking → review → **Confirm** or **Decline** (with reason).
3. On confirm → **Assign** driver + vehicle per leg. Server checks availability, capacity, buffer, then saves; the database exclusion constraint is the final guard.
4. Optionally edit booking or change fare (triggers customer approval flow).
5. On trip day → update trip status (in progress → completed), record cash payments if paid to the driver.
6. Record refunds, cancel bookings per policy, view history and reports.

---

## 5. REST API endpoints

All JSON. Errors use one format: `{ "error": { "code": "...", "message": "...", "fields": {...} } }`.

### Public
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config/public` | Business name, contact, enabled payment options, Maps public key |
| GET | `/api/vehicle-categories` | Fleet for fleet page and booking form |
| GET | `/api/routes` | Popular/fixed routes for routes page |
| POST | `/api/quotes` | Get itemised fare quote |
| POST | `/api/promotions/validate` | Check a promo or referral code |
| POST | `/api/bookings` | Create booking (rate-limited, idempotent) |
| GET | `/api/bookings/:reference?t=token` | Customer views own booking |
| POST | `/api/bookings/:reference/cancel` | Customer cancels per policy |
| POST | `/api/bookings/:reference/fare-response` | Accept/reject revised fare |
| POST | `/api/bookings/:reference/payment-intent` | Start online payment |
| POST | `/api/contact` | Contact form |

### Webhooks
| POST | `/api/webhooks/stripe` | Verified signature; updates payments |

### Admin auth
| POST | `/api/admin/auth/login` | Rate-limited, lockout after repeated failures |
| POST | `/api/admin/auth/logout` | |
| GET | `/api/admin/auth/me` | Current user + role |
| POST | `/api/admin/auth/change-password` | |

### Admin resources (all require login; role checked per route)
| Area | Endpoints |
|---|---|
| Dashboard | `GET /api/admin/dashboard/stats`, `GET /api/admin/dashboard/upcoming` |
| Bookings | `GET /bookings` (search, filter, paginate), `GET /bookings/:id`, `PATCH /bookings/:id`, `POST /bookings/:id/confirm`, `/decline`, `/cancel`, `PATCH /bookings/:id/legs/:legId/status`, `POST /bookings/:id/assignments`, `DELETE /bookings/:id/assignments/:aid`, `POST /bookings/:id/revise-fare`, `POST /bookings/:id/notes`, `GET /bookings/:id/history` |
| Availability | `GET /api/admin/availability?legId=` returns eligible drivers and vehicles |
| Drivers | `GET/POST /drivers`, `GET/PATCH /drivers/:id`, `GET /drivers/:id/schedule`, `PUT /drivers/:id/availability` |
| Vehicles | `GET/POST /vehicles`, `PATCH /vehicles/:id`, `POST /vehicles/:id/photo`, `GET /vehicles/:id/schedule` |
| Pricing | `GET/POST/PATCH /pricing/fixed-routes`, `/pricing/distance-rates`, `/pricing/surcharges`, `POST /pricing/publish` (creates a new rule-set version) |
| Promotions | `GET/POST/PATCH /promotions` |
| Customers | `GET /customers`, `GET /customers/:id` |
| Payments | `GET /payments`, `POST /payments/record`, `POST /payments/:id/refund` |
| Notifications | `GET /notifications`, `POST /notifications/:id/retry` |
| Reports | `GET /reports/bookings`, `/revenue`, `/routes`, `/repeat-customers`, `/referrals` |
| Settings | `GET/PUT /settings` |
| Staff | `GET/POST/PATCH /users` (owner only) |

---

## 6. Fare calculation rules

Order of evaluation, per vehicle category, per leg:

1. **Fixed route match**: if an active fixed route exists for this origin/destination (matched by place ID or within a set radius) and vehicle category, use `fare_cents`. Fixed routes can be defined in both directions.
2. **Otherwise distance pricing** (only if the route is within a configured service area):
   `fare = max(minimum_fare, base_fare + billable_km × per_km_rate)`
   Distance comes from the Google Routes API. If the API is not configured or fails, the system **refuses to quote** and shows "request a manual quote". It never uses a fake distance.
3. **Add surcharges**: night, public holiday, child seats, extra stops, known tolls/parking (flat or percent, as configured).
4. **Return trips**: price each leg, then apply the configured return rule (e.g. percentage discount on the second leg). Each leg is stored separately.
5. **Subtract approved discounts**: promo code, referral, loyalty. Discounts never take the total below zero (or below an optional floor).
6. **Round** to whole cents (documented rounding rule), apply GST handling per setting.

Stored on every booking: the itemised breakdown (JSON), the rule-set version, pricing method, and the distance/duration used. Later price changes cannot alter existing bookings. If the owner revises the fare, the booking stays `pending customer approval` until the customer accepts.

Quote tokens are signed by the server and expire, so a customer cannot tamper with the price in the browser.

---

## 7. Authentication and security approach

**Authentication**
- Passwords hashed with **argon2id**. No default or hardcoded admin password: the first owner account is created with a one-time CLI script (`npm run create-owner`) that asks for credentials.
- Session cookie: `httpOnly`, `Secure`, `SameSite=Lax`, stored server-side in PostgreSQL, idle and absolute timeouts, rotated on login.
- Login rate limit and temporary lockout. Optional two-factor authentication planned as an upgrade for the owner account.

**Authorisation**
- Middleware `requireAuth` and `requireRole('owner')` on every admin route, on the server. Hiding a button in the browser is never treated as security.
- Customers see a booking only with an unguessable token (random, stored hashed).

**Input and output**
- All input validated with `zod`. All queries parameterised (no string-built SQL).
- XSS: never insert user text with `innerHTML`; use `textContent` or an escaping helper. Strict Content-Security-Policy via `helmet`.
- CSRF: SameSite cookies plus a CSRF token header on every state-changing admin request.
- Uploads: type and size limits, re-encoded with `sharp`, random filenames, stored outside the web root.

**Payments**
- Stripe Elements on the client so card data never touches our server or database. Server stores only provider IDs and status.
- Webhook signature verification; processed event IDs stored to stop duplicates.
- Test mode until the client approves go-live.

**Operations**
- HTTPS only in production, HSTS, secrets in environment variables, `.env` git-ignored.
- Rate limits on login, quotes, bookings, contact form. Honeypot field plus optional CAPTCHA on public forms.
- Structured logs that avoid personal data and secrets. Audit log for admin actions.
- Daily automated database backups and a documented restore test.
- Privacy: privacy policy and terms pages, data retention setting, encrypted driver licence fields.

---

## 8. Development plan

| Stage | Contents | Output you can run |
|---|---|---|
| 1 | This plan (approval) | Document |
| 2 | Design system (CSS variables), navigation, homepage with booking form, booking page layout, dashboard shell | Static pages on mock data (clearly labelled) |
| 3 | PostgreSQL setup, migrations, auth, quote engine, booking API, frontend wired to API, confirmation page | Customers can request a booking end to end |
| 4 | Admin booking management, drivers, vehicles, assignment with conflict checks, payments (Stripe test mode), email notifications | Owner can run daily operations |
| 5 | SEO and route pages, promotions, referrals, loyalty, reviews, analytics, reports | Growth features |
| 6 | Test suite, security review, deployment guide, backups, client handover guide | Production-ready release |

Each stage ends with: what was completed, files created, how to run it, and what remains. I will wait for your approval at each boundary.

---

## 9. Next step

Please confirm or change the decisions in section 0 (especially PostgreSQL, Google Maps, Stripe, guest bookings) and answer whichever client questions you can. After your approval I will begin **Stage 2: design system and public pages**.
