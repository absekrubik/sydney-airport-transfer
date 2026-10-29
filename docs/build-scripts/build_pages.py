#!/usr/bin/env python3
"""Generates the static HTML pages so the header, footer and admin shell stay identical everywhere.

Usage (from the project root):
    python3 docs/build-scripts/build_pages.py          # write every page
    python3 docs/build-scripts/build_pages.py --sync   # only re-sync header/footer in existing public pages

After the first build you can edit the HTML files by hand. Re-run with --sync whenever you change
the menu, phone number or footer text below, and it updates every public page at once.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PUB, ADM = ROOT / 'public', ROOT / 'admin'

BRAND = 'Sydney Airport Transfers'
PHONE_DISPLAY, PHONE_LINK = '0400 000 000', '+61400000000'   # PLACEHOLDER
EMAIL = 'hello@example.com.au'         # PLACEHOLDER
WHATSAPP = '61400000000'               # PLACEHOLDER (digits only, with country code)
FONTS = ('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800'
         '&display=swap')
NAV = [('index.html', 'Home'), ('services.html', 'Services'), ('vehicles.html', 'Vehicles'),
       ('routes.html', 'Routes'), ('about.html', 'About'), ('contact.html', 'Contact')]


CUR = ' aria-current="page"'
ICON = 'assets/images/brand/'


def logo(href, prefix='', extra='', dark=False):
    mark = 'logo-mark-dark.png' if dark else 'logo-mark.png'
    return (f'<a class="logo" href="{href}" aria-label="{BRAND} home"{extra}><img class="logo__mark" src="{prefix}assets/images/brand/{mark}" alt="" width="85" height="44">'
            '<span class="logo__text"><b>Sydney</b><small>Airport Transfers</small></span></a>')


def ic(name, sprite='assets/icons/sprite.svg', cls='icon'):
    return f'<svg class="{cls}" aria-hidden="true"><use href="{sprite}#{name}"/></svg>'


def header(active):
    links = ''.join(f'<a href="{h}"{CUR if h == active else ""}>{t}</a>' for h, t in NAV)
    mobile = ''.join(f'<a href="{h}">{t}</a>' for h, t in NAV)
    return f'''<!-- site-header:start -->
  <div class="notice-bar"><div class="container notice-bar__inner">
    <p>Free cancellation until your driver is on the way.</p>
    <a href="tel:{PHONE_LINK}" data-biz-tel>{ic('phone')} <span>Call <span data-biz="phone">{PHONE_DISPLAY}</span></span></a>
  </div></div>
  <header class="site-header">
    <div class="container site-header__inner">
      {logo('index.html')}
      <nav class="nav" aria-label="Main">{links}</nav>
      <a class="btn btn--primary btn--sm" href="booking.html">Book a transfer</a>
      <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-label="Open menu">{ic('menu')}</button>
    </div>
    <nav class="mobile-nav" data-mobile-nav aria-label="Mobile">{mobile}</nav>
  </header>
  <!-- site-header:end -->'''


def footer():
    return f'''<!-- site-footer:start -->
  <footer class="site-footer">
    <div class="container">
      <div class="grid grid--4">
        <div>{logo('index.html', dark=True)}
          <p style="margin-top:var(--sp-4)">Fixed-fare airport transfers across Sydney.</p></div>
        <div><h4>Explore</h4><a href="services.html">Services</a><a href="vehicles.html">Vehicles</a><a href="routes.html">Routes</a><a href="about.html">About</a></div>
        <div><h4>Contact</h4><a href="tel:{PHONE_LINK}" data-biz-tel data-biz="phone">{PHONE_DISPLAY}</a><a href="mailto:{EMAIL}" data-biz-mail data-biz="email">{EMAIL}</a>
          <a href="https://wa.me/{WHATSAPP}" target="_blank" rel="noopener" data-biz-wa>WhatsApp us</a><a href="contact.html" data-biz="serviceArea">Sydney, NSW</a></div>
        <div><h4>Policies</h4><a href="#">Terms and conditions</a><a href="#">Privacy policy</a><a href="#">Cancellation policy</a></div>
      </div>
      <div class="site-footer__bottom"><span>&copy; <span data-year></span> <span data-biz="name">{BRAND}</span>. <span data-biz="abn">ABN to be added.</span></span><span>Social media links to be added</span></div>
    </div>
  </footer>
  <a class="whatsapp-fab" data-biz-wa href="https://wa.me/{WHATSAPP}?text=Hi%2C%20I%27d%20like%20to%20enquire%20about%20an%20airport%20transfer." target="_blank" rel="noopener" aria-label="Chat on WhatsApp">{ic('message-circle')}</a>
  <!-- site-footer:end -->'''


def head(title, desc, css=(), og=False):
    css_links = ''.join(f'\n  <link rel="stylesheet" href="assets/css/{c}">' for c in css)
    og_tags = ''
    if og:
        og_tags = f'''
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{desc}">
  <!-- og:image needs an absolute URL in production, e.g. https://yourdomain.com.au/assets/images/og-image.png -->
  <meta property="og:image" content="assets/images/og-image.png">
  <meta name="twitter:card" content="summary_large_image">'''
    return f'''<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <link rel="icon" type="image/png" href="{ICON}icon-64.png">
  <link rel="apple-touch-icon" href="{ICON}icon-192.png">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{desc}">{og_tags}
  <meta name="theme-color" content="#eaf2f9">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="{FONTS}" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/tokens.css?v=16">
  <link rel="stylesheet" href="assets/css/base.css?v=16">
  <link rel="stylesheet" href="assets/css/components.css?v=16">
  <link rel="stylesheet" href="assets/css/motion.css?v=16">{css_links}
</head>'''


def page(active, title, desc, body, script, css=(), og=False):
    return f'''{head(title, desc, css, og)}
<body>
  <a class="skip-link" href="#main">Skip to main content</a>
  {header(active)}

  <main id="main">
{body}
  </main>

  {footer()}
  <script type="module" src="assets/js/pages/{script}"></script>
</body>
</html>
'''


def page_hero(title, lead):
    return f'''    <section class="page-hero"><div class="container"><h1>{title}</h1><p>{lead}</p></div></section>'''


# --------------------------------------------------------------------------- HOME
def home():
    chip = lambda v, t: f'<button type="button" class="chip" data-value="{v}">{t}</button>'
    body = f'''    <section class="hero">
        <div class="hero__fx" aria-hidden="true">
          <i class="cloud"></i><i class="cloud"></i><i class="cloud"></i>
          <svg viewBox="0 0 1200 520" preserveAspectRatio="xMidYMid slice" focusable="false">
            <path id="flight-path" class="trail" d="M-60 330 C 220 60, 640 20, 1260 210"/>
            <g class="plane"><animateMotion dur="11s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#flight-path"/></animateMotion>
              <path class="plane-body" d="M-28 -4 L10 -4 L-10 -30 L0 -30 L30 -4 L52 -4 C60 -4 62 4 52 4 L30 4 L0 30 L-10 30 L10 4 L-28 4 L-34 14 L-42 14 L-36 0 L-42 -14 L-34 -14 Z" transform="scale(.5)"/></g>
          </svg>
        </div>
      <div class="container">
        <div class="hero__copy">
          <h1>Landed.<br>Your driver is <em>already there.</em></h1>
          <p class="hero__lead">Fixed fares between Sydney Airport and anywhere in Sydney. Cancel for free until your driver is on the way.</p>
        </div>
        <img class="hero__scene" src="assets/images/hero-scene-uv.svg" alt="" width="720" height="360">

        <!-- The booking form is the boarding pass and the main thing on the page -->
        <div class="pass-wrap">
          <form class="pass" id="home-booking-form" novalidate aria-labelledby="pass-title">
            <div class="pass__main">
              <div class="pass__top">
                <h2 class="pass__title" id="pass-title">Where to?</h2>
                <div class="segmented" role="radiogroup" aria-label="Trip type">
                  <input type="radio" id="tt-one" name="tripType" value="one_way" checked><label for="tt-one">One way</label>
                  <input type="radio" id="tt-ret" name="tripType" value="return"><label for="tt-ret">Return</label>
                </div>
              </div>

              <div class="pass__route">
                <div class="field pass__place">
                  <label for="pickup">From</label>
                  <input class="input" id="pickup" name="pickup" list="locations" autocomplete="off" placeholder="Sydney Airport" required>
                  <span class="field__error" aria-live="polite"></span>
                  <div class="chips" data-chips-for="pickup">{chip("Sydney Airport (SYD) – Domestic Terminal", "Domestic terminal")}{chip("Sydney Airport (SYD) – International Terminal", "International terminal")}</div>
                </div>
                <button class="swap" type="button" id="swap" aria-label="Swap pickup and destination">{ic('swap')}</button>
                <div class="field pass__place">
                  <label for="destination">To</label>
                  <input class="input" id="destination" name="destination" list="locations" autocomplete="off" placeholder="Hotel or address" required>
                  <span class="field__error" aria-live="polite"></span>
                  <div class="chips" data-chips-for="destination">{chip("Sydney CBD", "Sydney CBD")}{chip("Parramatta", "Parramatta")}{chip("Bondi Beach", "Bondi")}{chip("Manly", "Manly")}</div>
                </div>
              </div>
              <datalist id="locations"></datalist>

              <div class="pass__when">
                <div class="field">
                  <label for="date">Pickup date</label>
                  <input class="input" type="date" id="date" name="date" required>
                  <span class="field__error" aria-live="polite"></span>
                  <div class="chips" data-date-chips><button type="button" class="chip" data-offset="0">Today</button><button type="button" class="chip" data-offset="1">Tomorrow</button></div>
                </div>
                <div class="field"><label for="time">Pickup time</label><input class="input" type="time" id="time" name="time" required><span class="field__error" aria-live="polite"></span></div>
                <div class="field" data-return-field hidden><label for="returnDate">Return date</label><input class="input" type="date" id="returnDate" name="returnDate"><span class="field__error" aria-live="polite"></span></div>
                <div class="field" data-return-field hidden><label for="returnTime">Return time</label><input class="input" type="time" id="returnTime" name="returnTime"><span class="field__error" aria-live="polite"></span></div>
              </div>
            </div>

            <div class="pass__stub">
              <div class="field"><span class="label" id="pax-label">Passengers</span>
                <div class="stepper" data-stepper data-min="1" data-max="11" data-unit="passenger" role="group" aria-labelledby="pax-label">
                  <button type="button" class="stepper__btn" data-dir="-1" aria-label="Fewer passengers">{ic('minus')}</button><output class="stepper__value" aria-live="polite"></output><button type="button" class="stepper__btn" data-dir="1" aria-label="More passengers">{ic('plus')}</button>
                  <input type="hidden" name="passengers" value="1"></div></div>
              <div class="field"><span class="label" id="bag-label">Luggage</span>
                <div class="stepper" data-stepper data-min="0" data-max="12" data-unit="bag" data-none="No luggage" role="group" aria-labelledby="bag-label">
                  <button type="button" class="stepper__btn" data-dir="-1" aria-label="Fewer bags">{ic('minus')}</button><output class="stepper__value" aria-live="polite"></output><button type="button" class="stepper__btn" data-dir="1" aria-label="More bags">{ic('plus')}</button>
                  <input type="hidden" name="luggage" value="1"></div></div>
              <p class="pass__fare" id="fare-hint" aria-live="polite">Enter your route to see a fare.</p>
              <button class="btn btn--primary btn--block" type="submit">See fares and vehicles {ic('arrow-right')}</button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <div class="marquee" aria-hidden="true"><div class="marquee__track"><span>Sydney CBD</span><span>Parramatta</span><span>Bondi Beach</span><span>Manly</span><span>North Sydney</span><span>Chatswood</span><span>Darling Harbour</span><span>Circular Quay</span><span>Surry Hills</span><span>Newtown</span><span>Sydney CBD</span><span>Parramatta</span><span>Bondi Beach</span><span>Manly</span><span>North Sydney</span><span>Chatswood</span><span>Darling Harbour</span><span>Circular Quay</span><span>Surry Hills</span><span>Newtown</span></div></div>

    <section class="stats" aria-label="At a glance">
      <div class="container"><ul class="stats__grid">
        <li><span class="stats__num" data-count="4">4</span><span class="stats__label">Vehicle classes</span><span class="stats__text">Sedan, SUV, van and luxury</span></li>
        <li><span class="stats__num">GST</span><span class="stats__label">Included</span><span class="stats__text">One price, extras listed upfront</span></li>
        <li><span class="stats__num">Free</span><span class="stats__label">Cancellation</span><span class="stats__text">Until your driver is on the way</span></li>
        <li><span class="stats__num" data-count="3">3</span><span class="stats__label">Ways to pay</span><span class="stats__text">Online, deposit or to the driver</span></li>
      </ul></div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section__head">
          <h2>Popular routes from Sydney Airport</h2>
          <p id="routes-note" hidden>Sample routes and fares for development. The final list will match the client's confirmed service areas.</p>
        </div>
        <div class="board" id="popular-routes" role="list">
          <div class="board__head" aria-hidden="true"><div class="board__row"><span>Route</span><span>Sedan fare, GST included</span></div></div>
        </div>
        <p style="margin-top:var(--sp-5)"><a class="link-arrow" href="routes.html">All routes {ic('arrow-right')}</a></p>
      </div>
    </section>

    <section class="section section--sky">
      <div class="container why">
        <div>
          <h2>A transfer that does what it says.</h2>
          <p>You see the fare before you book, we plan around your flight, and a real person confirms every request.</p>
        </div>
        <ul class="why__list">
          <li><strong>Fixed fares</strong>The price you see includes GST, and any extras are listed before you pay.</li>
          <li><strong>Flight aware</strong>Add your flight number and we plan around delays.</li>
          <li><strong>Professional drivers</strong>Courteous, local drivers in clean, comfortable vehicles.</li>
          <li><strong>Flexible changes</strong>Cancel for free until your driver is marked on the way.</li>
        </ul>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="section__head"><h2>How it works</h2></div>
        <div class="steps-wrap">
        <div class="steps__track" aria-hidden="true"><span class="steps__fill"></span><span class="steps__car"><svg viewBox="0 0 70 34" fill="currentColor" aria-hidden="true"><path d="M4 22c0-4 2-6 6-7l10-8c2-1.5 4-2 7-2h14c4 0 7 1.5 10 4l6 6c5 .5 9 1.5 11 4 1 1 1 3 0 4H4z"/><circle cx="20" cy="26" r="6" fill="#1d1750"/><circle cx="52" cy="26" r="6" fill="#1d1750"/><circle cx="20" cy="26" r="2.4"/><circle cx="52" cy="26" r="2.4"/></svg></span></div>
        <ol class="steps">
          <li><h3>Enter your trip</h3><p>Tell us where and when. Fixed-fare routes show a price straight away.</p></li>
          <li><h3>We confirm it</h3><p>We review your request, confirm it with you, and assign your driver.</p></li>
          <li><h3>Ride</h3><p>Your driver meets you on time. Pay online, pay a deposit, or pay the driver.</p></li>
        </ol>
        </div>
      </div>
    </section>

    <section class="section journey">
      <div class="container journey__grid">
        <div>
          <h2>From touchdown to doorstep</h2>
          <p>Your driver watches your flight, meets you on arrival and takes the direct route.</p>
        </div>
        <figure class="journey__frame">
          <video id="journey-video" autoplay muted loop playsinline preload="metadata" poster="assets/video/hero-poster.jpg" aria-label="Animation of a car driving past the Sydney skyline, Opera House and Harbour Bridge while a plane comes in to land">
            <source src="assets/video/hero-loop.webm" type="video/webm">
            <source src="assets/video/hero-loop.mp4" type="video/mp4">
          </video>
          <button class="btn btn--ghost btn--sm journey__toggle" type="button" id="journey-toggle" aria-pressed="false">Pause animation</button>
        </figure>
      </div>
    </section>

    <section class="section section--sky">
      <div class="container">
        <div class="section__head"><h2>Choose your ride</h2></div>
        <div class="fleet" id="fleet-preview"></div>
        <p style="margin-top:var(--sp-6)"><a class="link-arrow" href="vehicles.html">See all vehicles {ic('arrow-right')}</a></p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <p class="alert alert--dev" style="max-width:560px">Sample text for layout. Replace with a genuine customer review before launch.</p>
        <blockquote class="quote"><p class="quote__text">Sample review text will go here once the first real customers have travelled with us.</p><footer>Customer name, route</footer></blockquote>
      </div>
    </section>

    <section class="section section--sky">
      <div class="container faq-wrap">
        <div><h2>Questions we hear a lot</h2><p>Can't find your answer? <a href="contact.html">Ask us</a>.</p></div>
        <div class="faq">
          <details><summary>Can I cancel my booking?</summary><p>Yes. Cancelling is free until your driver is marked as on the way. After that, a percentage of the fare applies, and you see the exact amount before you confirm.</p></details>
          <details><summary>How do I pay?</summary><p>Pay online by card, pay a deposit online and the balance to the driver, or pay the driver. The options available are shown on your booking.</p></details>
          <details><summary>What if my flight is delayed?</summary><p>Add your flight number when you book so we can plan for delays. Any waiting charge is shown in your fare.</p></details>
          <details><summary>Are fares GST-inclusive?</summary><p>Yes. Every fare includes GST, and the GST amount is shown on your quote.</p></details>
          <details><summary>Which areas do you cover?</summary><p>We cover Sydney. If your address is outside our fixed-fare routes, you can request a quote.</p></details>
        </div>
      </div>
    </section>

    <section class="cta-band">
      <div class="container cta-band__inner">
        <h2>Know your fare in a minute.</h2>
        <a class="btn btn--primary" href="booking.html">Book a transfer {ic('arrow-right')}</a>
      </div>
      <div class="road" aria-hidden="true"><span class="road__car"><svg viewBox="0 0 70 34" fill="currentColor" aria-hidden="true"><path d="M4 22c0-4 2-6 6-7l10-8c2-1.5 4-2 7-2h14c4 0 7 1.5 10 4l6 6c5 .5 9 1.5 11 4 1 1 1 3 0 4H4z"/><circle cx="20" cy="26" r="6" fill="#1d1750"/><circle cx="52" cy="26" r="6" fill="#1d1750"/><circle cx="20" cy="26" r="2.4"/><circle cx="52" cy="26" r="2.4"/></svg></span></div>
    </section>'''
    return page('index.html', 'Airport Transfers in Sydney | Sydney Airport Transfers',
                'Fixed-fare airport transfers in Sydney with professional drivers and flight-aware pickups. Free cancellation until your driver is on the way.',
                body, 'home.js', css=('pages/home.css',), og=True)


# --------------------------------------------------------------------------- BOOKING
def booking():
    stepper = lambda label_id, name, mn, mx, unit, val, none='': (
        f'<div class="stepper" data-stepper data-min="{mn}" data-max="{mx}" data-unit="{unit}"' + (f' data-none="{none}"' if none else '') +
        f' role="group" aria-labelledby="{label_id}"><button type="button" class="stepper__btn" data-dir="-1" aria-label="Fewer {unit}s">{ic("minus")}</button>'
        f'<output class="stepper__value" aria-live="polite"></output><button type="button" class="stepper__btn" data-dir="1" aria-label="More {unit}s">{ic("plus")}</button>'
        f'<input type="hidden" name="{name}" value="{val}"></div>')
    chip = lambda v, t: f'<button type="button" class="chip" data-value="{v}">{t}</button>'
    steps = ''.join(f'<li><button type="button" class="progress__btn" data-goto="{i}"><span class="progress__num">{i}</span><span class="progress__label">{t}</span></button></li>'
                    for i, t in enumerate(['Trip', 'Vehicle', 'Your details', 'Review'], 1))
    body = f'''    <div class="container">
      <div class="booking-head">
        <h1>Book your transfer</h1>
        <p class="alert alert--dev" id="dev-notice" hidden></p>
      </div>
      <ol class="progress" aria-label="Booking steps">{steps}</ol>

      <div class="booking-layout">
        <form class="booking-form" id="booking-form" novalidate>
          <!-- Honeypot: real users never see or fill this; bots often do. Checked on the server. -->
          <input class="honeypot" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">

          <section class="step" data-step="1" aria-labelledby="h-1">
            <h2 id="h-1" tabindex="-1">Where and when?</h2>
            <div class="segmented" role="radiogroup" aria-label="Trip type" style="margin-bottom:var(--sp-5)">
              <input type="radio" id="tt-one" name="tripType" value="one_way" checked><label for="tt-one">One way</label>
              <input type="radio" id="tt-ret" name="tripType" value="return"><label for="tt-ret">Return</label>
            </div>
            <div class="route-pair">
              <div class="field">
                <label for="pickup">Pickup address</label>
                <input class="input" id="pickup" name="pickup" list="locations" autocomplete="off" required>
                <span class="field__error" aria-live="polite"></span>
                <div class="chips" data-chips-for="pickup">{chip("Sydney Airport (SYD) – Domestic Terminal", "Domestic terminal")}{chip("Sydney Airport (SYD) – International Terminal", "International terminal")}</div>
              </div>
              <button class="swap" type="button" id="swap" aria-label="Swap pickup and destination">{ic('swap')}</button>
              <div class="field">
                <label for="destination">Destination address</label>
                <input class="input" id="destination" name="destination" list="locations" autocomplete="off" required>
                <span class="field__error" aria-live="polite"></span>
                <div class="chips" data-chips-for="destination">{chip("Sydney CBD", "Sydney CBD")}{chip("Parramatta", "Parramatta")}{chip("Bondi Beach", "Bondi")}{chip("Manly", "Manly")}</div>
              </div>
            </div>
            <datalist id="locations"></datalist>
            <p class="field__hint">Start typing a place we serve, pick a chip, or use “Set on map”.</p>

            <div class="form-row" style="margin-top:var(--sp-5)">
              <div class="field"><label for="date">Pickup date</label><input class="input" type="date" id="date" name="date" required><span class="field__error" aria-live="polite"></span>
                <div class="chips" data-date-chips><button type="button" class="chip" data-offset="0">Today</button><button type="button" class="chip" data-offset="1">Tomorrow</button></div></div>
              <div class="field"><label for="time">Pickup time</label><input class="input" type="time" id="time" name="time" required><span class="field__error" aria-live="polite"></span></div>
            </div>
            <div class="form-row" data-return-field hidden style="margin-top:var(--sp-4)">
              <div class="field"><label for="returnDate">Return date</label><input class="input" type="date" id="returnDate" name="returnDate"><span class="field__error" aria-live="polite"></span></div>
              <div class="field"><label for="returnTime">Return time</label><input class="input" type="time" id="returnTime" name="returnTime"><span class="field__error" aria-live="polite"></span></div>
            </div>

            <div class="form-row" style="margin-top:var(--sp-5)">
              <div class="field"><span class="label" id="l-pax">Passengers</span>{stepper('l-pax', 'passengers', 1, 11, 'passenger', 1)}</div>
              <div class="field"><span class="label" id="l-bag">Luggage</span>{stepper('l-bag', 'luggage', 0, 12, 'bag', 1, 'No luggage')}</div>
              <div class="field"><span class="label" id="l-seat">Child seats</span>{stepper('l-seat', 'childSeats', 0, 3, 'seat', 0, 'None')}</div>
            </div>
            <div class="field" style="margin-top:var(--sp-5);max-width:320px"><label for="flight">Flight number (optional)</label><input class="input" id="flight" name="flight" maxlength="10" placeholder="e.g. QF401" autocomplete="off"><span class="field__hint">We use it to plan around delays.</span></div>
          </section>

          <section class="step" data-step="2" aria-labelledby="h-2" hidden>
            <h2 id="h-2" tabindex="-1">Choose your vehicle</h2>
            <p class="text-muted" id="vehicle-note"></p>
            <div id="vehicle-options" class="vehicle-options" role="radiogroup" aria-label="Vehicle"></div>
            <span class="field__error" id="vehicle-error" aria-live="polite"></span>
            <div class="manual-quote" id="manual-quote" hidden>
              <h3>This route needs a quote</h3>
              <p>It does not have a fixed fare yet. Tell us the details and we will reply with a price.</p>
              <a class="btn btn--primary" id="manual-quote-link" href="contact.html">Request a quote {ic('arrow-right')}</a>
            </div>
          </section>

          <section class="step" data-step="3" aria-labelledby="h-3" hidden>
            <h2 id="h-3" tabindex="-1">Your details</h2>
            <p class="text-muted">We use these details to confirm your booking and contact you about your trip. We never share them.</p>
            <div class="form-row">
              <div class="field"><label for="name">Full name</label><input class="input" id="name" name="name" autocomplete="name" required maxlength="100"><span class="field__error" aria-live="polite"></span></div>
              <div class="field"><label for="phone">Mobile phone</label><input class="input" type="tel" id="phone" name="phone" autocomplete="tel" inputmode="tel" required maxlength="20" placeholder="0400 000 000"><span class="field__error" aria-live="polite"></span></div>
            </div>
            <div class="field" style="margin-top:var(--sp-4)"><label for="email">Email</label><input class="input" type="email" id="email" name="email" autocomplete="email" required maxlength="150"><span class="field__error" aria-live="polite"></span></div>
            <div class="field" style="margin-top:var(--sp-4)"><label for="notes">Anything we should know? (optional)</label><textarea class="textarea" id="notes" name="notes" maxlength="500" placeholder="Meeting point, accessibility needs, extra stops"></textarea></div>
            <div class="field" style="margin-top:var(--sp-4);max-width:320px"><label for="promo">Promo or referral code (optional)</label><input class="input" id="promo" name="promo" maxlength="30" autocomplete="off"></div>
          </section>

          <section class="step" data-step="4" aria-labelledby="h-4" hidden>
            <h2 id="h-4" tabindex="-1">Review and request</h2>
            <dl class="review" id="review"></dl>
            <fieldset class="pay-options">
              <legend class="label">How would you like to pay?</legend>
              <label class="pay-option"><input type="radio" name="payment" value="card_online" checked><span><strong>Pay online by card</strong><small>Pay the full fare securely by card right after you book.</small></span></label>
              <label class="pay-option"><input type="radio" name="payment" value="deposit"><span><strong>Pay a deposit online</strong><small data-deposit-text>Pay a deposit by card now and the balance to your driver.</small></span></label>
              <label class="pay-option"><input type="radio" name="payment" value="cash_to_driver"><span><strong>Pay the driver</strong><small>Pay on the day. Nothing is charged now.</small></span></label>
            </fieldset>
            <div class="next-steps">
              <h3>What happens next</h3>
              <ol><li>You get a reference and a private link to your booking straight away. Save it.</li><li>We review your request and confirm it with you.</li><li>You can cancel for free until your driver is on the way.</li></ol>
            </div>
            <div class="field" id="terms-field" style="margin-top:var(--sp-5)">
              <label class="check"><input type="checkbox" id="terms" name="terms"><span>I agree to the terms and the cancellation policy. After the driver is on the way, a percentage of the fare applies if I cancel.</span></label>
              <span class="field__error" aria-live="polite"></span>
            </div>
          </section>

          <div class="wizard-bar">
            <div class="wizard-bar__total" id="bar-total" aria-live="polite"></div>
            <button type="button" class="btn btn--ghost" id="back" hidden>Back</button>
            <button type="button" class="btn btn--primary" id="next">Choose a vehicle {ic('arrow-right')}</button>
            <button type="submit" class="btn btn--primary" id="submit" hidden>Request booking</button>
          </div>
        </form>

        <aside class="summary" aria-labelledby="sum-title">
          <h2 id="sum-title">Your trip</h2>
          <dl id="summary-details"></dl>
          <div id="summary-quote" aria-live="polite"></div>
        </aside>
      </div>
    </div>'''
    return page('booking.html', 'Book an Airport Transfer | Sydney Airport Transfers',
                'Enter your trip, choose a vehicle and request your Sydney airport transfer in four short steps.',
                body, 'booking.js', css=('pages/booking.css',))


# --------------------------------------------------------------------------- INNER PAGES
def services():
    items = [('plane', 'Airport transfers', 'Be met on arrival or collected on time for your flight. Fixed fares from the domestic and international terminals.', 'booking.html'),
             ('building', 'Hotel and apartment transfers', 'Door to door between the airport and your stay, with room for your luggage.', 'booking.html'),
             ('briefcase', 'Corporate transport', 'Reliable rides for staff and clients, with clear GST-inclusive fares that keep expense reports simple.', 'contact.html'),
             ('sparkles', 'Event transfers', 'Weddings, concerts and functions across Sydney. Tell us the plan and we will quote it.', 'contact.html'),
             ('users', 'Group journeys', 'Our Group Van seats up to 7 passengers with space for 8 bags. Larger groups, just ask.', 'vehicles.html'),
             ('baby', 'Child seats', 'Add child seats when you book. Each seat appears as its own line in your fare.', 'booking.html')]
    cards = ''.join(f'''<article class="svc"><div class="icon-badge">{ic(i)}</div><h3>{t}</h3><p>{d}</p><a class="link-arrow" href="{h}">{'Book this' if h == 'booking.html' else 'Learn more' if h == 'vehicles.html' else 'Request a quote'} {ic('arrow-right')}</a></article>''' for i, t, d, h in items)
    body = page_hero('Rides for every kind of journey.', 'From a solo arrival to a wedding party, one team and one clear way to book.') + f'''
    <section class="section"><div class="container">
      <p class="alert alert--dev" style="max-width:640px;margin-bottom:var(--sp-6)">The service list is a draft. Confirm which services the business offers before launch.</p>
      <div class="svc-grid">{cards}</div>
    </div></section>'''
    return page('services.html', 'Services | Sydney Airport Transfers', 'Airport, hotel, corporate, event and group transfers across Sydney.', body, 'page.js', css=('pages/pages.css',))


def vehicles():
    body = page_hero('Choose the ride that fits.', 'Four vehicle types for solo travellers, families and groups. Every fare includes GST.') + f'''
    <section class="section"><div class="container">
      <p class="alert alert--dev" id="sample-note" style="max-width:640px;margin-bottom:var(--sp-6)">Sample illustrations are shown until real vehicle photos are added.</p>
      <div class="fleet-list" id="fleet-list"></div>
    </div></section>'''
    return page('vehicles.html', 'Vehicles | Sydney Airport Transfers', 'Sedans, SUVs, vans and luxury cars for airport transfers in Sydney.', body, 'vehicles.js', css=('pages/pages.css',))


def routes():
    body = page_hero('Popular routes.', 'Fixed fares between Sydney Airport and the places people go most. Pick a route to start your booking.') + f'''
    <section class="section"><div class="container">
      <p class="alert alert--dev" id="routes-sample" hidden style="max-width:640px;margin-bottom:var(--sp-6)">Sample routes and fares. The final list matches the client's confirmed service areas.</p>
      <div class="table-scroll"><table class="route-table"><thead><tr><th scope="col">Route</th><th scope="col">Sedan</th><th scope="col">SUV</th><th scope="col">Van</th><th scope="col">Luxury</th><th scope="col"><span class="visually-hidden">Book</span></th></tr></thead><tbody id="route-rows"></tbody></table></div>
      <p class="text-muted" style="margin-top:var(--sp-4)">Fares are one way and include GST. Return trips, child seats and any waiting time are shown before you book. Going somewhere else? <a href="contact.html">Request a quote</a>.</p>
    </div></section>'''
    return page('routes.html', 'Routes | Sydney Airport Transfers', 'Fixed airport transfer fares from Sydney Airport to the CBD, Parramatta, Bondi and Manly.', body, 'routes.js', css=('pages/pages.css',))


def about():
    vals = [('clock', 'On time', 'We plan around your flight, so your driver is there when you are.'),
            ('banknote', 'Clear pricing', 'You see the fare, the GST and any extras before you book.'),
            ('shield-check', 'Safe and clean', 'Well-kept vehicles and professional drivers on every trip.'),
            ('user', 'Real people', 'A person reviews every request and confirms it with you.')]
    cards = ''.join(f'<div class="svc"><div class="icon-badge">{ic(i)}</div><h3>{t}</h3><p>{d}</p></div>' for i, t, d in vals)
    body = page_hero('Reliable rides, plainly priced.', 'We started with one idea: an airport transfer should be easy to book and easy to trust.') + f'''
    <section class="section"><div class="container">
      <p class="alert alert--dev" style="max-width:640px;margin-bottom:var(--sp-6)">Company story, licences and insurance details are placeholders. The client supplies the final text.</p>
      <div class="section__head"><h2>What you can expect</h2></div>
      <div class="svc-grid">{cards}</div>
    </div></section>
    <section class="cta-band"><div class="container cta-band__inner"><h2>Ready when you are.</h2><a class="btn btn--primary" href="booking.html">Book a transfer {ic('arrow-right')}</a></div><div class="road" aria-hidden="true"><span class="road__car"><svg viewBox="0 0 70 34" fill="currentColor" aria-hidden="true"><path d="M4 22c0-4 2-6 6-7l10-8c2-1.5 4-2 7-2h14c4 0 7 1.5 10 4l6 6c5 .5 9 1.5 11 4 1 1 1 3 0 4H4z"/><circle cx="20" cy="26" r="6" fill="#1d1750"/><circle cx="52" cy="26" r="6" fill="#1d1750"/><circle cx="20" cy="26" r="2.4"/><circle cx="52" cy="26" r="2.4"/></svg></span></div></section>'''
    return page('about.html', 'About | Sydney Airport Transfers', 'Why travellers book Sydney airport transfers with us.', body, 'page.js', css=('pages/pages.css', 'pages/home.css'))


def contact():
    body = page_hero('Talk to us.', 'Questions, quotes for unusual routes, or a change to a booking. We reply by email, phone or WhatsApp.') + f'''
    <section class="section"><div class="container contact-grid">
      <form class="contact-form" id="contact-form" novalidate>
        <input class="honeypot" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="form-row">
          <div class="field"><label for="c-name">Full name</label><input class="input" id="c-name" name="name" autocomplete="name" required maxlength="100"><span class="field__error" aria-live="polite"></span></div>
          <div class="field"><label for="c-phone">Phone (optional)</label><input class="input" id="c-phone" name="phone" type="tel" autocomplete="tel" maxlength="20"><span class="field__error" aria-live="polite"></span></div>
        </div>
        <div class="field"><label for="c-email">Email</label><input class="input" id="c-email" name="email" type="email" autocomplete="email" required maxlength="150"><span class="field__error" aria-live="polite"></span></div>
        <div class="field"><label for="c-message">How can we help?</label><textarea class="textarea" id="c-message" name="message" required maxlength="1500"></textarea><span class="field__error" aria-live="polite"></span></div>
        <button class="btn btn--primary" type="submit">Send message</button>
      </form>
      <aside class="contact-card">
        <h2>Prefer to chat?</h2>
        <ul class="contact-list">
          <li>{ic('phone')}<div><strong>Phone</strong><a href="tel:{PHONE_LINK}" data-biz-tel data-biz="phone">{PHONE_DISPLAY}</a></div></li>
          <li>{ic('mail')}<div><strong>Email</strong><a href="mailto:{EMAIL}" data-biz-mail data-biz="email">{EMAIL}</a></div></li>
          <li>{ic('message-circle')}<div><strong>WhatsApp</strong><a href="https://wa.me/{WHATSAPP}" target="_blank" rel="noopener" data-biz-wa>Start a chat</a></div></li>
          <li>{ic('map-pin')}<div><strong>Service area</strong><span>Sydney, NSW</span></div></li>
          <li>{ic('clock')}<div><strong>Hours</strong><span>To be confirmed by the client</span></div></li>
        </ul>
        <p class="alert alert--dev">Contact details are placeholders.</p>
      </aside>
    </div></section>'''
    return page('contact.html', 'Contact | Sydney Airport Transfers', 'Contact us about airport transfers, quotes and booking changes in Sydney.', body, 'contact.js', css=('pages/pages.css',))


def confirmation():
    body = f'''    <section class="section"><div class="container">
      <div class="confirm-wrap" id="confirm-root" aria-live="polite">
        <p class="text-muted">Loading your booking…</p>
      </div>
    </div></section>'''
    return page('', 'Your booking | Sydney Airport Transfers', 'Your booking reference, trip and fare.', body, 'confirmation.js', css=('pages/pages.css', 'pages/booking.css'))


# --------------------------------------------------------------------------- ADMIN
ADMIN_NAV = [('dashboard.html', 'layout-dashboard', 'Dashboard'), ('bookings.html', 'clipboard-list', 'Bookings'), ('customers.html', 'users', 'Customers'), ('messages.html', 'mail', 'Messages'),
             ('drivers.html', 'id-card', 'Drivers'), ('vehicles.html', 'car', 'Vehicles'), ('pricing.html', 'tag', 'Pricing'),
             ('payments.html', 'credit-card', 'Payments'), ('promotions.html', 'percent', 'Promotions'), ('reports.html', 'bar-chart', 'Reports'),
             ('settings.html', 'sliders', 'Settings')]
SPR = '../public/assets/icons/sprite.svg'


def admin_page(active, title, inner, script='stub.js'):
    nav = ''.join(f'<a href="{h}"{CUR if h == active else ""}>{ic(i, SPR)} {t}</a>' for h, i, t in ADMIN_NAV)
    return f'''<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <link rel="icon" type="image/png" href="../public/{ICON}icon-64.png">
  <link rel="apple-touch-icon" href="../public/{ICON}icon-192.png">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>{title} | {BRAND} Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="{FONTS}" rel="stylesheet">
  <!-- Dev paths: Stage 3 serves public/assets at /assets, so these become /assets/... then. -->
  <link rel="stylesheet" href="../public/assets/css/tokens.css?v=16">
  <link rel="stylesheet" href="../public/assets/css/base.css?v=16">
  <link rel="stylesheet" href="../public/assets/css/components.css?v=16">
  <link rel="stylesheet" href="assets/css/admin.css?v=16">
</head>
<body class="admin">
  <div class="admin-shell">
    <aside class="sidebar" id="sidebar" aria-label="Admin navigation">
      {logo('dashboard.html', '../public/')}
      <nav>{nav}</nav>
    </aside>
    <div class="scrim"></div>
    <div>
      <header class="topbar">
        <button class="icon-btn menu-btn" type="button" data-menu-btn aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">{ic('menu', SPR)}</button>
        <div class="topbar__search">
          {ic('search', SPR)}
          <label class="visually-hidden" for="global-search">Search bookings</label>
          <input class="input" id="global-search" type="search" placeholder="Search bookings, customers">
        </div>
        <button class="icon-btn" type="button" aria-label="Notifications">{ic('bell', SPR)}<span class="dot"></span></button>
        <div class="profile">
          <button class="icon-btn" type="button" data-profile-btn aria-haspopup="true" aria-expanded="false" aria-label="Profile menu">{ic('user', SPR)}</button>
          <div class="profile-menu" role="menu">
            <a href="settings.html" role="menuitem">Settings</a>
            <span class="profile-menu__who" id="whoami"></span>
            <button type="button" role="menuitem" data-logout>Sign out</button>
          </div>
        </div>
      </header>
      <main class="content" id="main">
{inner}
      </main>
    </div>
  </div>
  <script type="module" src="assets/js/{script}"></script>
</body>
</html>
'''


def admin_stub(file, title, stage='Stage 4'):
    inner = f'''        <div class="page-head"><h1>{title}</h1></div>
        <div class="empty-state card"><h3>{title} arrives in {stage}</h3><p style="margin-inline:auto">This screen is part of the admin area. It connects to the database once the backend is built.</p><a class="btn btn--ghost btn--sm" href="dashboard.html">Back to the dashboard</a></div>'''
    return admin_page(file, title, inner)


def admin_dashboard():
    inner = f'''        <div class="page-head">
          <h1>Dashboard</h1>
          <a class="btn btn--primary btn--sm" href="bookings.html">All bookings</a>
        </div>
        <p class="alert alert--dev" id="dash-note" hidden></p>
        <div class="stat-grid" id="stat-grid"></div>
        <h2>Latest bookings</h2>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Reference</th><th>Pickup time</th><th>Route</th><th>Status</th><th>Payment</th></tr></thead>
            <tbody id="recent-rows"><tr><td colspan="5">Loading…</td></tr></tbody>
          </table>
        </div>'''
    return admin_page('dashboard.html', 'Dashboard', inner, 'dashboard.js')


def admin_bookings():
    inner = f'''        <div class="page-head"><h1>Bookings</h1></div>
        <div class="toolbar">
          <label class="visually-hidden" for="f-q">Search</label>
          <input class="input" id="f-q" type="search" placeholder="Reference, name, email or phone" maxlength="100">
          <label class="visually-hidden" for="f-status">Status</label>
          <select class="select" id="f-status"><option value="">All statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="declined">Declined</option></select>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Reference</th><th>Customer</th><th>Pickup time</th><th>Route</th><th>Vehicle</th><th>Total</th><th>Status</th><th>Payment</th></tr></thead>
            <tbody id="booking-rows"><tr><td colspan="8">Loading…</td></tr></tbody>
          </table>
        </div>
        <div class="toolbar" style="margin-top:var(--sp-4)">
          <button class="btn btn--ghost btn--sm" type="button" id="prev">Previous</button>
          <span class="text-muted" id="page-info"></span>
          <button class="btn btn--ghost btn--sm" type="button" id="more">Next</button>
        </div>
        <dialog id="detail" aria-labelledby="detail-title"><div style="padding:var(--sp-5)">
          <h2 id="detail-title">Booking</h2><div id="detail-body"></div>
          <p style="margin-top:var(--sp-4)"><button class="btn btn--ghost btn--sm" type="button" id="detail-close">Close</button></p>
        </div></dialog>'''
    return admin_page('bookings.html', 'Bookings', inner, 'bookings.js')


def admin_vehicles():
    inner = '''        <div class="page-head"><h1>Vehicles</h1><button class="btn btn--primary" type="button" id="add-vehicle">Add vehicle</button></div>
        <p class="text-muted" style="max-width:640px;margin-bottom:var(--sp-5)">Add, edit or hide vehicle types. Upload a photo of each vehicle type. Use a clear landscape photo of the real vehicle. It is resized automatically and appears on the homepage, the vehicles page and the booking page straight away. You can also paste a link to an image from the web. Only use images you have permission to use commercially (your own photos, your supplier's, or free-for-commercial-use sites).</p>
        <div class="vgrid" id="vehicle-grid"><p class="text-muted">Loading…</p></div>'''
    return admin_page('vehicles.html', 'Vehicles', inner, 'vehicles.js')


def admin_pricing():
    inner = '''        <div class="page-head"><h1>Pricing</h1><span class="text-muted" id="p-version"></span></div>
        <p class="alert alert--error" id="p-error" hidden></p>
        <p class="alert alert--dev" id="p-sample" hidden>These are sample fares from setup. Replace them with your real prices before you go live.</p>
        <section class="card" style="margin-bottom:var(--sp-5)">
          <h2 style="font-size:1.2rem;margin:0 0 var(--sp-3)">Rules</h2>
          <div class="rules-grid">
            <div class="field"><label for="p-return">Return trip discount (%)</label><input class="input" id="p-return" type="number" min="0" max="100" step="1"></div>
            <div class="field"><label for="p-seat">Child seat, each way ($)</label><input class="input" id="p-seat" type="number" min="0" max="1000" step="0.01"></div>
            <div class="field"><label for="p-cancel">Cancellation fee after the driver is on the way (%)</label><input class="input" id="p-cancel" type="number" min="0" max="100" step="1"></div>
          </div>
          <p class="text-muted" style="font-size:var(--fs-sm);margin:var(--sp-3) 0 0">Cancelling is always free until the driver is marked “on the way”. All prices include GST.</p>
        </section>
        <section class="card" style="margin-bottom:var(--sp-5)">
          <h2 style="font-size:1.2rem;margin:0 0 var(--sp-2)">Distance pricing</h2>
          <p class="text-muted" style="max-width:680px;margin:0 0 var(--sp-3)">For trips that are not on a fixed route, the price is the base fee plus the price per kilometre of the real driving distance, but never less than the minimum fare. It is rounded up to a whole dollar. Fixed fares always win. Only trips within about 100 km of Sydney CBD are priced; anything else is a quote request.</p>
          <p class="alert alert--dev" id="p-routing" hidden>Distance lookup is not connected yet, so these trips still ask for a quote. Add your free OpenRouteService key as ORS_API_KEY in the .env file (see the README).</p>
          <label class="check" style="margin-bottom:var(--sp-3)"><input type="checkbox" id="p-dist-on"><span><strong>Price other trips by driving distance</strong></span></label>
          <div class="table-wrap"><table class="data fares"><thead><tr><th>Vehicle</th><th>Base fee ($)</th><th>Per km ($)</th><th>Minimum fare ($)</th></tr></thead><tbody id="rate-rows"><tr><td colspan="4">Loading…</td></tr></tbody></table></div>
          <p class="text-muted" style="font-size:var(--fs-sm);margin:var(--sp-3) 0 0">Leave a vehicle’s boxes empty to not sell distance-priced trips in it. Example: base $20 + $3.40 per km, minimum $85: a 20 km trip is $88.</p>
        </section>
        <section>
          <h2 style="font-size:1.2rem;margin:0 0 var(--sp-2)">Fixed fares (one way, GST included)</h2>
          <p class="text-muted" style="max-width:640px;margin:0 0 var(--sp-3)">The same fare applies in both directions. Leave a box empty if you do not sell a fixed fare for that route and vehicle; customers then ask for a quote.</p>
          <div class="table-wrap"><table class="data fares"><thead><tr id="fare-head"></tr></thead><tbody id="fare-rows"><tr><td>Loading…</td></tr></tbody></table></div>
        </section>
        <div class="savebar"><span class="text-muted" id="save-state"></span><button class="btn btn--ghost" type="button" id="discard">Discard changes</button><button class="btn btn--primary" type="button" id="save" disabled>Save prices</button></div>'''
    return admin_page('pricing.html', 'Pricing', inner, 'pricing.js')


def admin_drivers():
    inner = '''        <div class="page-head"><h1>Drivers</h1><button class="btn btn--primary" type="button" id="add-driver">Add driver</button></div>
        <p class="text-muted" style="max-width:640px;margin-bottom:var(--sp-4)">Keep a list of your drivers here, then assign one to each trip from the booking. Drivers do not log in; you tell them the details yourself.</p>
        <div class="table-wrap"><table class="data"><thead><tr><th>Driver</th><th>Contact</th><th>Vehicle</th><th>Upcoming trips</th><th></th></tr></thead><tbody id="driver-rows"><tr><td colspan="5">Loading…</td></tr></tbody></table></div>'''
    return admin_page('drivers.html', 'Drivers', inner, 'drivers.js')


def admin_customers():
    inner = '''        <div class="page-head"><h1>Customers</h1></div>
        <div class="toolbar"><label class="visually-hidden" for="c-q">Search</label><input class="input" id="c-q" type="search" placeholder="Name, email or phone" maxlength="100"></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Customer</th><th>Contact</th><th>Bookings</th><th>Booked value</th><th>Last booking</th><th>Marketing</th></tr></thead><tbody id="customer-rows"><tr><td colspan="6">Loading…</td></tr></tbody></table></div>
        <div class="toolbar" style="margin-top:var(--sp-4)"><button class="btn btn--ghost btn--sm" type="button" id="prev">Previous</button><span class="text-muted" id="page-info"></span><button class="btn btn--ghost btn--sm" type="button" id="more">Next</button></div>
        <dialog id="detail" aria-labelledby="detail-title"><div style="padding:var(--sp-5)"><h2 id="detail-title">Customer</h2><div id="detail-body"></div><p style="margin-top:var(--sp-4)"><button class="btn btn--ghost btn--sm" type="button" id="detail-close">Close</button></p></div></dialog>'''
    return admin_page('customers.html', 'Customers', inner, 'customers.js')


def admin_messages():
    inner = '''        <div class="page-head"><h1>Messages</h1><span class="text-muted" id="m-open"></span></div>
        <p class="text-muted" style="max-width:640px;margin-bottom:var(--sp-4)">Messages from the website contact form and quote requests. Reply from your own email or phone, then mark the message as handled.</p>
        <div class="toolbar"><label class="visually-hidden" for="m-filter">Show</label><select class="select" id="m-filter"><option value="no">Waiting for a reply</option><option value="">All messages</option><option value="yes">Handled</option></select></div>
        <div class="msg-list" id="msg-list"><p class="text-muted">Loading…</p></div>'''
    return admin_page('messages.html', 'Messages', inner, 'messages.js')


def admin_promotions():
    inner = '''        <div class="page-head"><h1>Promotions</h1><button class="btn btn--primary" type="button" id="add-promo">New promo code</button></div>
        <p class="text-muted" style="max-width:640px;margin-bottom:var(--sp-4)">Codes customers can enter on the booking page. The discount comes off the total fare (GST included), and the saving is shown in the customer’s quote.</p>
        <div class="table-wrap"><table class="data"><thead><tr><th>Code</th><th>Discount</th><th>When</th><th>Used</th><th>Status</th><th></th></tr></thead><tbody id="promo-rows"><tr><td colspan="6">Loading…</td></tr></tbody></table></div>'''
    return admin_page('promotions.html', 'Promotions', inner, 'promotions.js')


def admin_settings():
    fld = lambda i, label, extra='', hint='': f'<div class="field"><label for="{i}">{label}</label><input class="input" id="{i}" {extra}>' + (f'<span class="text-muted" style="font-size:var(--fs-xs)">{hint}</span>' if hint else '') + f'<span class="field__error" id="err-{i[2:]}" style="color:var(--danger);font-size:var(--fs-xs)"></span></div>'
    pay = lambda k, label, hint: f'<label class="check"><input type="checkbox" id="pay-{k}"><span><strong>{label}</strong><br><span class="text-muted">{hint}</span></span></label>'
    inner = f'''        <div class="page-head"><h1>Settings</h1></div>
        <p class="alert alert--error" id="settings-error" hidden></p>
        <form id="settings-form" novalidate>
          <section class="card" style="margin-bottom:var(--sp-5)"><h2 style="font-size:1.2rem;margin:0 0 var(--sp-3)">Business details</h2>
            <p class="text-muted" style="margin:0 0 var(--sp-4)">Shown in the website header, footer and contact page, and on invoices and emails.</p>
            <div class="rules-grid">
              {fld('b-name', 'Business name', 'type="text" maxlength="80"')}
              {fld('b-abn', 'ABN', 'type="text" maxlength="20" inputmode="numeric"', '11 digits. Leave blank until you have it.')}
              {fld('b-phone', 'Phone', 'type="tel" maxlength="30"')}
              {fld('b-email', 'Email', 'type="email" maxlength="120"')}
              {fld('b-whatsapp', 'WhatsApp number', 'type="text" maxlength="20" inputmode="numeric"', 'Digits only with country code, e.g. 61400000000')}
              {fld('b-serviceArea', 'Service area', 'type="text" maxlength="80"')}
            </div>
          </section>
          <section class="card" style="margin-bottom:var(--sp-5)"><h2 style="font-size:1.2rem;margin:0 0 var(--sp-3)">How customers can pay</h2>
            <div class="checks">
              {pay('card_online', 'Pay online by card', 'Customer pays the full fare by card.')}
              {pay('deposit', 'Deposit online, balance to the driver', 'Customer pays part now and the rest in the car.')}
              {pay('cash_to_driver', 'Pay the driver', 'Customer pays the driver on the day.')}
            </div><p class="field__error" id="err-payments" style="color:var(--danger);font-size:var(--fs-sm)"></p>
            <div class="rules-grid" style="margin-top:var(--sp-4)">
              <div class="field"><label for="dep-pct">Deposit (% of the fare)</label><input class="input" id="dep-pct" type="number" min="5" max="95" step="1"><span class="text-muted" style="font-size:var(--fs-xs)">Charged now when a customer chooses the deposit option.</span><span class="field__error" id="err-deposit" style="color:var(--danger);font-size:var(--fs-xs)"></span></div>
            </div>
            <p class="alert alert--dev" id="stripe-status" style="margin-top:var(--sp-4)" hidden></p>
          </section>
          <section class="card" style="margin-bottom:var(--sp-5)"><h2 style="font-size:1.2rem;margin:0 0 var(--sp-3)">Booking rules</h2>
            <div class="rules-grid">
              <div class="field"><label for="min-lead">Shortest notice (minutes)</label><input class="input" id="min-lead" type="number" min="0" max="20160" step="15"><span class="text-muted" style="font-size:var(--fs-xs)">180 = customers must book at least 3 hours ahead.</span><span class="field__error" id="err-lead" style="color:var(--danger);font-size:var(--fs-xs)"></span></div>
              <div class="field"><label for="max-adv">How far ahead (days)</label><input class="input" id="max-adv" type="number" min="1" max="730" step="1"><span class="field__error" id="err-adv" style="color:var(--danger);font-size:var(--fs-xs)"></span></div>
            </div>
            <p class="text-muted" style="margin:var(--sp-3) 0 0">The cancellation fee percentage is on the Pricing page.</p>
          </section>
          <div class="savebar"><button class="btn btn--primary" type="submit" id="save">Save settings</button></div>
        </form>'''
    return admin_page('settings.html', 'Settings', inner, 'settings.js')


def admin_payments():
    inner = """        <div class="page-head"><h1>Payments</h1><a class="btn btn--ghost btn--sm" id="export" href="#" hidden>Download CSV</a></div>
        <p class="alert alert--dev" id="stripe-note" hidden></p>
        <div class="stat-grid" id="pay-stats"></div>
        <section id="due-box" hidden><h2>Refunds still to send</h2>
          <p class="text-muted" style="max-width:640px">These bookings were cancelled or declined and money paid by card has not been fully returned yet.</p>
          <div class="table-wrap"><table class="data"><thead><tr><th>Booking</th><th>Customer</th><th>Owed to customer</th><th></th></tr></thead><tbody id="due-rows"></tbody></table></div>
        </section>
        <h2>All payments</h2>
        <div class="toolbar">
          <label class="visually-hidden" for="p-from">From</label><input class="input" id="p-from" type="date">
          <label class="visually-hidden" for="p-to">To</label><input class="input" id="p-to" type="date">
          <label class="visually-hidden" for="p-kind">Type</label><select class="select" id="p-kind"><option value="">Payments and refunds</option><option value="payment">Payments</option><option value="refund">Refunds</option></select>
          <span class="text-muted" id="p-sum"></span>
        </div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Booking</th><th>Customer</th><th>Type</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead><tbody id="pay-rows"><tr><td colspan="7">Loading…</td></tr></tbody></table></div>
        <div class="toolbar" style="margin-top:var(--sp-4)"><button class="btn btn--ghost btn--sm" type="button" id="prev">Previous</button><span class="text-muted" id="page-info"></span><button class="btn btn--ghost btn--sm" type="button" id="more">Next</button></div>"""
    return admin_page('payments.html', 'Payments', inner, 'payments.js')


def admin_reports():
    inner = """        <div class="page-head"><h1>Reports</h1></div>
        <p class="alert alert--error" id="rep-error" hidden></p>
        <div class="toolbar">
          <label class="visually-hidden" for="r-from">From</label><input class="input" id="r-from" type="date">
          <label class="visually-hidden" for="r-to">To</label><input class="input" id="r-to" type="date">
          <label class="visually-hidden" for="r-group">Group by</label><select class="select" id="r-group"><option value="day">By day</option><option value="week">By week</option><option value="month">By month</option></select>
          <button class="btn btn--primary btn--sm" type="button" id="r-go">Update</button>
          <a class="btn btn--ghost btn--sm" id="r-csv" href="#">Download payments CSV</a>
        </div>
        <p class="text-muted" id="r-range" style="margin:0 0 var(--sp-3)"></p>
        <div class="stat-grid" id="r-stats"></div>
        <h2>Over time</h2>
        <div class="table-wrap"><table class="data"><thead><tr><th id="r-per">Period</th><th>Bookings</th><th>Booked value</th><th>Money received</th><th>Refunded</th></tr></thead><tbody id="r-series"></tbody></table></div>
        <div class="rules-grid" style="margin-top:var(--sp-6);grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
          <section><h2>By vehicle</h2><div class="table-wrap"><table class="data"><thead><tr><th>Vehicle</th><th>Bookings</th><th>Value</th></tr></thead><tbody id="r-vehicles"></tbody></table></div></section>
          <section><h2>Top routes</h2><div class="table-wrap"><table class="data"><thead><tr><th>Route</th><th>Bookings</th><th>Value</th></tr></thead><tbody id="r-routes"></tbody></table></div></section>
          <section><h2>Bookings by status</h2><div class="table-wrap"><table class="data"><thead><tr><th>Status</th><th>Bookings</th></tr></thead><tbody id="r-status"></tbody></table></div></section>
          <section><h2>How customers chose to pay</h2><div class="table-wrap"><table class="data"><thead><tr><th>Option</th><th>Bookings</th></tr></thead><tbody id="r-pref"></tbody></table></div></section>
        </div>
        <p class="text-muted" style="max-width:720px;margin-top:var(--sp-5)">Booked value counts confirmed and completed bookings by the day they were made. Money received counts payments and refunds by the day they happened, so it can differ. GST is one eleventh of money received (prices include GST).</p>"""
    return admin_page('reports.html', 'Reports', inner, 'reports.js')


def admin_login():
    return f'''<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <link rel="icon" type="image/png" href="../public/{ICON}icon-64.png">
  <link rel="apple-touch-icon" href="../public/{ICON}icon-192.png">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Sign in | {BRAND} Admin</title>
  <link href="{FONTS}" rel="stylesheet">
  <link rel="stylesheet" href="../public/assets/css/tokens.css?v=16">
  <link rel="stylesheet" href="../public/assets/css/base.css?v=16">
  <link rel="stylesheet" href="../public/assets/css/components.css?v=16">
  <link rel="stylesheet" href="assets/css/admin.css?v=16">
</head>
<body class="admin" style="display:grid;place-items:center;min-height:100vh;padding:1rem">
  <main class="card" style="width:min(100%,420px);padding:var(--sp-6)">
    <img src="../public/assets/images/brand/logo-mark.png" alt="{BRAND}" width="240" height="124" style="display:block;width:min(70%,240px);height:auto;margin:0 auto var(--sp-2)">
    <p style="text-align:center;margin-bottom:var(--sp-5)"><span class="logo__text" style="display:inline-flex;align-items:center"><b>Sydney</b><small>Airport Transfers</small></span></p>
    <h1 style="font-size:2.4rem">Admin sign in</h1>
    <p class="alert alert--error" id="login-error" role="alert" hidden></p>
    <form class="stack" id="login-form" novalidate style="margin-top:var(--sp-4)">
      <div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="password">Password</label><input class="input" id="password" type="password" autocomplete="current-password" required></div>
      <button class="btn btn--primary btn--block" type="submit" id="login-btn">Sign in</button>
    </form>
  </main>
  <script type="module" src="assets/js/login.js"></script>
</body>
</html>
'''


# --------------------------------------------------------------------------- RUN
def sync_chrome():
    """Replace the header and footer blocks in every public page between their marker comments."""
    for f in PUB.glob('*.html'):
        s = f.read_text()
        m = re.search(r'<a class="skip-link"', s)
        active = ''
        a = re.search(r'<a href="([a-z]+\.html)" aria-current="page">', s)
        if a: active = a.group(1)
        s = re.sub(r'<!-- site-header:start -->.*?<!-- site-header:end -->', lambda _: header(active), s, flags=re.S)
        s = re.sub(r'<!-- site-footer:start -->.*?<!-- site-footer:end -->', lambda _: footer(), s, flags=re.S)
        f.write_text(s)
        print('synced', f.name)


if __name__ == '__main__':
    if '--sync' in sys.argv:
        sync_chrome(); sys.exit()
    pages = {PUB / 'index.html': home(), PUB / 'booking.html': booking(), PUB / 'services.html': services(), PUB / 'vehicles.html': vehicles(),
             PUB / 'routes.html': routes(), PUB / 'about.html': about(), PUB / 'contact.html': contact(), PUB / 'confirmation.html': confirmation(),
             ADM / 'dashboard.html': admin_dashboard(), ADM / 'bookings.html': admin_bookings(), ADM / 'login.html': admin_login(), ADM / 'vehicles.html': admin_vehicles(), ADM / 'pricing.html': admin_pricing(), ADM / 'drivers.html': admin_drivers(), ADM / 'customers.html': admin_customers(), ADM / 'messages.html': admin_messages(), ADM / 'promotions.html': admin_promotions(), ADM / 'settings.html': admin_settings()}
    pages[ADM / 'payments.html'] = admin_payments(); pages[ADM / 'reports.html'] = admin_reports()
    for path, html in pages.items():
        path.write_text(html); print('wrote', path.relative_to(ROOT))
