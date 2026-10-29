// Shared UI helpers used by public pages and the admin area.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Where the icon sprite lives, relative to the current page (admin pages sit one level deeper). */
const SPRITE = window.location.pathname.includes('/admin/') ? '../public/assets/icons/sprite.svg' : 'assets/icons/sprite.svg';

/** Build an <svg> icon element from the sprite. name: e.g. 'plane', 'check'. */
export function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${SPRITE}#${name}`);
  svg.appendChild(use);
  return svg;
}

export function initMobileNav() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const panel = document.querySelector('[data-mobile-nav]');
  if (!toggle || !panel) return;
  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

function toastRegion() {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }
  return region;
}

/** Show a short message. type: 'info' | 'success' | 'error' */
export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type === 'info' ? '' : ` toast--${type}`}`;
  el.textContent = message; // textContent (never innerHTML) so user text cannot inject markup
  toastRegion().appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/** Promise-based confirmation dialog. Resolves true if confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    const h = document.createElement('h3'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = message;
    const actions = document.createElement('div'); actions.className = 'dialog__actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn btn--ghost'; cancel.type = 'button'; cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.className = `btn ${danger ? 'btn--danger' : 'btn--navy'}`; ok.type = 'button'; ok.textContent = confirmLabel;
    actions.append(cancel, ok);
    dialog.append(h, p, actions);
    document.body.appendChild(dialog);
    const close = (result) => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    dialog.addEventListener('cancel', () => close(false));
    dialog.showModal();
  });
}

/** Format integer cents as Australian dollars, e.g. 8500 -> "$85.00". */
export function formatMoney(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

export function setFieldError(input, message) {
  const field = input.closest('.field');
  if (!field) return;
  field.classList.toggle('field--error', Boolean(message));
  const slot = field.querySelector('.field__error');
  if (slot) slot.textContent = message || '';
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

/** Move keyboard focus to the first field showing an error, so the problem is never off-screen. */
export function focusFirstError(root = document) {
  const bad = root.querySelector('[aria-invalid="true"]');
  if (bad) { bad.focus({ preventScroll: true }); bad.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}

/**
 * Plus/minus counters. Markup:
 *   <div class="stepper" data-stepper data-min="1" data-max="11" data-unit="passenger">
 *     <button type="button" class="stepper__btn" data-dir="-1" aria-label="Fewer passengers">…</button>
 *     <output class="stepper__value"></output>
 *     <button type="button" class="stepper__btn" data-dir="1" aria-label="More passengers">…</button>
 *     <input type="hidden" name="passengers" value="1">
 *   </div>
 */
export function initSteppers(root = document, onChange = () => {}) {
  root.querySelectorAll('[data-stepper]').forEach((el) => {
    const input = el.querySelector('input[type="hidden"]');
    const out = el.querySelector('.stepper__value');
    const min = Number(el.dataset.min ?? 0); const max = Number(el.dataset.max ?? 10);
    const unit = el.dataset.unit || ''; const none = el.dataset.none;
    const [minus, plus] = el.querySelectorAll('.stepper__btn');
    const render = () => {
      const v = Number(input.value);
      out.textContent = v === 0 && none ? none : `${v} ${unit}${v === 1 ? '' : 's'}`;
      minus.disabled = v <= min; plus.disabled = v >= max;
    };
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('.stepper__btn'); if (!btn) return;
      const next = Math.min(max, Math.max(min, Number(input.value) + Number(btn.dataset.dir)));
      if (next === Number(input.value)) return;
      input.value = String(next); render(); onChange();
    });
    el.render = render; render();
  });
}

/** Set a stepper's value from code (e.g. restoring a saved trip). */
export function setStepper(el, value) {
  const input = el.querySelector('input[type="hidden"]');
  input.value = String(value); el.render();
}

/** Today's date as YYYY-MM-DD in the visitor's local time zone. */
export function localDate(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Remember the trip between pages (this tab only; never stores name, email or phone) ----
const TRIP_KEY = 'skyline.trip';
export function loadTrip() {
  try { return JSON.parse(sessionStorage.getItem(TRIP_KEY)) || {}; } catch { return {}; }
}
export function saveTrip(trip) {
  try { sessionStorage.setItem(TRIP_KEY, JSON.stringify(trip)); } catch { /* storage unavailable: carry on */ }
}

/**
 * Scroll reveal. Elements matching the selector fade up once as they enter the viewport.
 * Elements start hidden and fade up as they scroll into view.
 */
export function initReveal(selector, { stagger = 70 } = {}) {
  if (!('IntersectionObserver' in window)) return; // without it, content simply stays visible
  const nodes = document.querySelectorAll(selector);
  if (!nodes.length) return;
  document.documentElement.classList.add('js-reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  nodes.forEach((node) => {
    const index = [...node.parentElement.children].indexOf(node);
    node.dataset.reveal = '';
    node.style.transitionDelay = `${Math.min(index, 6) * stagger}ms`;
    observer.observe(node);
  });
}

/** Fills an <img> for a vehicle from the API's `image` ({ url, photo }). Real photos fill the frame; illustrations sit inside it. */
export function setVehicleImage(img, vehicle) {
  img.src = vehicle.image?.url || `assets/images/vehicles/${vehicle.code}.svg`;
  if (vehicle.image?.photo) img.classList.add('is-photo');
}
