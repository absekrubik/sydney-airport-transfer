# Sydney Airport Transfers – Booking and Management System

Status: **Stage 3 (core functionality)**. Real server, database, quotes, bookings and admin sign-in.
Fares, vehicles and places are **development sample data** (marked on the site) until the client supplies real ones.
Payments (Stripe), emails and driver assignment arrive in Stage 4.

## Run it on your computer (Windows)

1. Install Node.js 22 or newer (https://nodejs.org) and PostgreSQL 16 (https://www.postgresql.org/download/windows/). Remember the postgres password you choose.
2. Create the database (in "SQL Shell (psql)" or pgAdmin): `CREATE DATABASE airport_transfers;`
3. In this folder, open a terminal and run:

       npm install
       copy .env.example .env

4. Edit `.env`: set `DATABASE_URL` (your postgres password) and `APP_SECRET` (the file shows how to generate one).
5. Then:

       npm run migrate
       npm run seed:dev
       npm run create-owner
       npm start

6. Open http://localhost:3000 (the website) and http://localhost:3000/admin/login.html (sign in with the owner you just created).

`npm run seed:dev` loads clearly labelled sample vehicles, places and fares. Edit or replace them before launch.

## Tests

    npm test                              # unit tests (no database needed)
    set TEST_DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/airport_transfers_test
    npm test                              # adds the database and HTTP end-to-end tests

Use a separate empty database for tests: it is wiped on every run.

## What exists in Stage 3
- PostgreSQL schema and migrations (`server/db/migrations`), exclusion-ready booking legs, status history, audit log.
- Quote engine: fixed fares first (both directions), return discount, child seats, GST (1/11), signed 15-minute quote tokens. No fake distances: a trip with no fixed fare becomes a manual quote request.
- Booking API with idempotency keys, honeypot, rate limits, guest view/cancel link (secret token), free cancellation until en route, then a configurable percentage.
- Admin: secure sign-in (scrypt hashing, server-side sessions, CSRF, lockout), dashboard numbers and booking list from real data.
- Website wired to the API: booking wizard, confirmation page, fleet, routes, contact form.

The plan and confirmed client answers are in `docs/stage-1-plan.md`.

## Real vehicle photos
Sign in to the admin portal, open **Vehicles**, and use **Upload photo** on each vehicle type. Photos are resized in the browser,
checked on the server (real JPG, PNG or WebP only, under 3 MB) and shown straight away on the homepage, vehicles page and booking page.
You can also paste an image link from the web (**Use link**): the server downloads it for you. Only https links to real JPG, PNG or WebP images are accepted, and private network addresses are refused. Only use images you have the right to use commercially.
**Remove photo** goes back to the sample illustration. Best results: a clear landscape photo of the real vehicle.

Uploaded photos are saved in `public/assets/images/vehicles/` on the server. Back that folder up, and if you host on a service
that wipes the disk on every deploy, use a persistent disk/volume for it. You can also copy files there by hand, named after the
category code (`sedan.jpg`, `suv.jpg`, `van.jpg`, `luxury.jpg`).


## Card payments (Stripe)

Card and deposit payments use Stripe Checkout (customers pay on Stripe's own page; card details never touch this server). Without keys the site still works and only offers "pay the driver".

1. Create a free Stripe account at dashboard.stripe.com and stay in test mode.
2. Developers > API keys: copy the **secret key** (`sk_test_...`) into `.env` as `STRIPE_SECRET_KEY`. The publishable key is not needed.
3. Install the Stripe CLI, run `stripe login`, then `stripe listen --forward-to localhost:3000/api/webhooks/stripe`. Copy the `whsec_...` it prints into `.env` as `STRIPE_WEBHOOK_SECRET`. Keep that window open while testing.
4. Set `PUBLIC_URL` (default `http://localhost:3000`) and restart the server.
5. Test with card `4242 4242 4242 4242`, any future expiry, any CVC.

When live: use a live key and add a webhook endpoint in the Stripe dashboard pointing to `https://YOURDOMAIN/api/webhooks/stripe` for the events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`.

How money is handled: cancel before the driver is on the way = full refund; after = the cancellation percentage (Pricing page) is kept and the rest refunded; staff cancel or decline = full refund. If a refund fails it shows under "Refunds still to send" on the Payments page and the owner can retry. Refund in Stripe's dashboard only if you also record it here, otherwise the figures will not match. Cash and bank payments are recorded by staff in the booking detail. Reports (owner only) and a CSV download are on the Payments and Reports pages.

## Fares for trips that are not on a fixed route (distance pricing)

Fixed fares always win. For any other trip within about 100 km of Sydney CBD where the customer has chosen exact points ("Set on map"), the price is the real driving distance x your per-km price, plus a base fee, never below a minimum, rounded up to a whole dollar. Set these per vehicle in Admin > Pricing > Distance pricing (owner only); every save is a new pricing version.

1. Create a free account at openrouteservice.org and make an API key.
2. Put it in `.env` as `ORS_API_KEY=...` and restart. (Check their site for the current free daily limit. Each new pickup/drop-off pair costs one lookup; repeats are remembered in the database, so you are only charged once per pair.)
3. Without a key, or if the service is down, or the trip is outside Sydney, the customer is simply offered a quote request, as before.

The sample rates (e.g. sedan $15 + $2.80/km, minimum $65) are placeholders: set your real ones before going live.
