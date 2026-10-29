// Motion layer: scroll progress, header shrink, counters, tilt, how-it-works car, hero parallax.
// Everything here is decoration. Nothing in it is needed to use the site.
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** Run fn at most once per animation frame while scrolling. */
function onScroll(fn) {
  let queued = false;
  const run = () => { queued = false; fn(); };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(run); } }, { passive: true });
  window.addEventListener('resize', run, { passive: true });
  run();
}

function initScrollEffects() {
  const bar = document.createElement('div'); bar.className = 'scroll-progress'; bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  const header = document.querySelector('.site-header');
  const steps = document.querySelector('.steps-wrap');
  const lit = steps ? [...steps.querySelectorAll('.steps li')] : [];
  onScroll(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty('--scroll', max > 0 ? (window.scrollY / max).toFixed(4) : '0');
    header?.classList.toggle('is-scrolled', window.scrollY > 24);
    if (steps) {
      const r = steps.getBoundingClientRect();
      const p = clamp((window.innerHeight * 0.85 - r.top) / (r.height + window.innerHeight * 0.1), 0, 1);
      steps.style.setProperty('--p', p.toFixed(3));
      lit.forEach((li, i) => li.classList.toggle('is-lit', p >= (i + 0.35) / lit.length));
    }
  });
}

/** Count a number up when it scrolls into view: <span data-count="4">. */
function initCounters() {
  const nodes = document.querySelectorAll('[data-count]');
  if (!nodes.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const node = e.target; const end = Number(node.dataset.count); const start = performance.now(); const dur = 1100;
      const tick = (t) => {
        const k = clamp((t - start) / dur, 0, 1);
        node.textContent = String(Math.round(end * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(tick); else node.classList.add('is-pop');
      };
      node.textContent = '0'; requestAnimationFrame(tick);
    });
  }, { threshold: 0.6 });
  nodes.forEach((n) => io.observe(n));
}

/** Cards lean towards the pointer. Fine-pointer devices only. */
export function initTilt(selector) {
  if (!canHover) return;
  document.querySelectorAll(selector).forEach((card) => {
    if (card.dataset.tilt !== undefined) return;
    card.dataset.tilt = '';
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
      card.classList.add('is-tilting');
      card.style.transform = `perspective(800px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg) translateY(-4px)`;
    });
    card.addEventListener('pointerleave', () => { card.classList.remove('is-tilting'); card.style.transform = ''; });
  });
}

/** The hero artwork drifts a little with the pointer. */
function initParallax() {
  const hero = document.querySelector('.hero'); const art = hero?.querySelector('.hero__scene');
  if (!art || !canHover) return;
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
    art.style.translate = `${(x * -22).toFixed(1)}px ${(y * -14).toFixed(1)}px`;
  });
  hero.addEventListener('pointerleave', () => { art.style.translate = ''; });
}

/** Brief pop when a value changes, e.g. the live fare. */
export function pop(node) {
  if (!node) return;
  node.classList.remove('is-pop'); void node.offsetWidth; node.classList.add('is-pop');
}

export function initMotion() {
  initScrollEffects(); initCounters(); initParallax();
  initTilt('.fleet__img, .fleet-row__img, .stats__grid li');
}

const NS = 'http://www.w3.org/2000/svg';
const CAR_SVG = `<svg viewBox="0 0 70 34" fill="currentColor" aria-hidden="true"><path d="M4 22c0-4 2-6 6-7l10-8c2-1.5 4-2 7-2h14c4 0 7 1.5 10 4l6 6c5 .5 9 1.5 11 4 1 1 1 3 0 4H4z"/><circle cx="20" cy="26" r="6" fill="#1d1750"/><circle cx="52" cy="26" r="6" fill="#1d1750"/><circle cx="20" cy="26" r="2.4"/><circle cx="52" cy="26" r="2.4"/></svg>`;

/** A car driving along a dashed road, shown while fares load. */
export function roadLoader(text = 'Checking fares…') {
  const box = document.createElement('div'); box.className = 'road-loader'; box.setAttribute('role', 'status');
  const p = document.createElement('p'); p.textContent = text;
  const road = document.createElement('span'); road.className = 'road-loader__road';
  const car = document.createElement('span'); car.className = 'road-loader__car'; car.innerHTML = CAR_SVG; // fixed markup, no user data
  box.append(p, road, car);
  return box;
}

/** A tick that draws itself with a small confetti burst. tone: "ok" (green) or "" (brand violet). */
export function successBurst(tone = '') {
  const wrap = document.createElement('div'); wrap.className = `burst${tone ? ` burst--${tone}` : ''}`; wrap.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 92 92');
  const ring = document.createElementNS(NS, 'circle'); Object.entries({ cx: 46, cy: 46, r: 40 }).forEach(([k, v]) => ring.setAttribute(k, v)); ring.setAttribute('class', 'burst__ring');
  const tick = document.createElementNS(NS, 'path'); tick.setAttribute('d', 'M28 47 L41 60 L65 34'); tick.setAttribute('class', 'burst__tick');
  svg.append(ring, tick); wrap.appendChild(svg);
  {
    const colours = ['#5b34f0', '#d6ff3f', '#8d5cff', '#f6c453', '#1d1750'];
    for (let i = 0; i < 16; i++) {
      const dot = document.createElement('i'); const a = (i / 16) * Math.PI * 2; const d = 60 + (i % 3) * 14;
      dot.style.setProperty('--x', `${Math.round(Math.cos(a) * d)}px`); dot.style.setProperty('--y', `${Math.round(Math.sin(a) * d)}px`); dot.style.setProperty('--c', colours[i % colours.length]);
      wrap.appendChild(dot);
    }
  }
  return wrap;
}
