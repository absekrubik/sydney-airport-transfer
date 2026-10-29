// Admin > Settings (owner only): business details, payment options and booking rules.
import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { toast } from '../../../public/assets/js/ui/ui.js';

const $ = (id) => document.getElementById(id);
const FIELDS = ['name', 'abn', 'phone', 'email', 'whatsapp', 'serviceArea'];

function fill(s) {
  FIELDS.forEach((f) => { $(`b-${f}`).value = s.business[f] || ''; });
  ['card_online', 'deposit', 'cash_to_driver'].forEach((k) => { $(`pay-${k}`).checked = s.payments[k] === true; });
  $('dep-pct').value = s.deposit.percent;
  const st = $('stripe-status');
  if (s.stripe) {
    st.hidden = false;
    st.textContent = s.stripe.ready
      ? `Card payments are connected to Stripe (${s.stripe.mode} mode).${s.stripe.webhook ? '' : ' The webhook secret is missing, so payments will not be marked as paid automatically.'}`
      : 'Card payments are not connected yet. Add your Stripe keys to the .env file (see the README). Until then customers only see the pay-the-driver option.';
  }
  $('min-lead').value = s.booking.min_lead_minutes; $('max-adv').value = s.booking.max_advance_days;
}

async function save(e) {
  e.preventDefault();
  document.querySelectorAll('.field__error').forEach((n) => { n.textContent = ''; });
  const body = {
    business: Object.fromEntries(FIELDS.map((f) => [f, $(`b-${f}`).value])),
    payments: Object.fromEntries(['card_online', 'deposit', 'cash_to_driver'].map((k) => [k, $(`pay-${k}`).checked])),
    deposit: { percent: $('dep-pct').value },
    booking: { min_lead_minutes: $('min-lead').value, max_advance_days: $('max-adv').value },
  };
  $('save').disabled = true;
  try { fill(await api('PUT', '/api/admin/settings', body)); toast('Settings saved. The website now uses them.', 'success'); }
  catch (err) {
    const map = { payments: 'err-payments', deposit_percent: 'err-deposit', min_lead_minutes: 'err-lead', max_advance_days: 'err-adv' };
    let shown = false;
    for (const [k, m] of Object.entries(err.fields || {})) { const n = $(map[k] || `err-${k}`); if (n) { n.textContent = m; shown = true; } }
    toast(shown ? 'Please check the highlighted fields.' : err.message, 'error');
  }
  $('save').disabled = false;
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  if (!(await requireAdmin())) return;
  try { fill(await api('GET', '/api/admin/settings')); } catch (e) { $('settings-error').hidden = false; $('settings-error').textContent = e.status === 403 ? 'Only the owner can change settings.' : e.message; $('settings-form').hidden = true; return; }
  $('settings-form').addEventListener('submit', save);
});
