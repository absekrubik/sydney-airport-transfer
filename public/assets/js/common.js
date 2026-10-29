// Runs on every public page: mobile menu, footer year, optional scroll reveal.
import { initMobileNav, initReveal } from './ui/ui.js';
import { initMotion } from './motion.js';

/** Fills phone, email, WhatsApp and ABN from what the owner saved in Admin > Settings. Blank values keep the page's defaults. */
async function applyBusiness() {
  try {
    const res = await fetch('/api/config/public', { credentials: 'same-origin' });
    if (!res.ok) return;
    const { business: b } = await res.json();
    if (b.phone) {
      const digits = b.phone.replace(/[^\d+]/g, '');
      document.querySelectorAll('[data-biz-tel]').forEach((a) => { a.href = `tel:${digits}`; });
      document.querySelectorAll('[data-biz="phone"]').forEach((n) => { n.textContent = b.phone; });
    }
    if (b.email) {
      document.querySelectorAll('[data-biz-mail]').forEach((a) => { a.href = `mailto:${b.email}`; });
      document.querySelectorAll('[data-biz="email"]').forEach((n) => { n.textContent = b.email; });
    }
    if (b.whatsapp) document.querySelectorAll('[data-biz-wa]').forEach((a) => { a.href = a.href.replace(/wa\.me\/\d+/, `wa.me/${b.whatsapp}`); });
    if (b.abn) document.querySelectorAll('[data-biz="abn"]').forEach((n) => { n.textContent = `ABN ${b.abn}.`; });
    if (b.serviceArea) document.querySelectorAll('[data-biz="serviceArea"]').forEach((n) => { n.textContent = b.serviceArea; });
    if (b.name) document.querySelectorAll('[data-biz="name"]').forEach((n) => { n.textContent = b.name; });
  } catch { /* the page keeps its built-in details */ }
}

export function initCommon(revealSelector = '') {
  document.querySelectorAll('[data-year]').forEach((n) => { n.textContent = String(new Date().getFullYear()); });
  initMobileNav();
  if (revealSelector) initReveal(revealSelector);
  initMotion();
  applyBusiness();
}
