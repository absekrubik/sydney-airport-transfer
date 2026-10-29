// Admin > Payments: money in and out, refunds still to send, and a CSV download for the accountant.
import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { formatMoney, toast, confirmDialog } from '../../../public/assets/js/ui/ui.js';
import { badge, sydneyTime } from './admin-util.js';

const $ = (id) => document.getElementById(id);
const SIZE = 25;
let page = 1; let me = null;
const td = (text) => { const c = document.createElement('td'); c.textContent = text; return c; };

function query(extra = {}) {
  const q = new URLSearchParams({ page: String(page), pageSize: String(SIZE), ...extra });
  if ($('p-from').value) q.set('from', $('p-from').value);
  if ($('p-to').value) q.set('to', $('p-to').value);
  if ($('p-kind').value) q.set('kind', $('p-kind').value);
  return q;
}

function tiles(o) {
  const grid = $('pay-stats'); grid.replaceChildren();
  [['Money received (all time)', o.recordedRevenueCents], ['Online payments waiting', o.pendingPaymentsCents], ['Still to collect (open bookings)', o.balanceDueCents], ['Refunds to send', o.refundsDue.reduce((a, r) => a + r.owedCents, 0)]].forEach(([label, v]) => {
    const card = document.createElement('div'); card.className = 'stat';
    const l = document.createElement('div'); l.className = 'stat__label'; l.textContent = label;
    const val = document.createElement('div'); val.className = 'stat__value'; val.textContent = formatMoney(v);
    card.append(l, val); grid.appendChild(card);
  });
}

function dueList(list) {
  $('due-box').hidden = list.length === 0;
  const rows = $('due-rows'); rows.replaceChildren();
  list.forEach((r) => {
    const tr = document.createElement('tr');
    const act = document.createElement('td');
    if (me.role === 'owner') {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn--primary btn--sm'; b.textContent = 'Refund now';
      b.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Refund this customer?', message: `${formatMoney(r.owedCents)} goes back to the card used for ${r.reference}.`, confirmLabel: 'Refund' }))) return;
        b.disabled = true;
        try { await api('POST', `/api/admin/bookings/${r.bookingId}/refund`, {}); toast('Refund sent.', 'success'); } catch (e) { toast(e.message, 'error'); }
        load();
      });
      act.appendChild(b);
    } else act.textContent = 'Ask the owner';
    tr.append(td(r.reference), td(r.customerName), td(formatMoney(r.owedCents)), act); rows.appendChild(tr);
  });
}

async function load() {
  const d = await api('GET', `/api/admin/payments?${query()}`);
  if (!$('p-from').value) { $('p-from').value = d.range.from; $('p-to').value = d.range.to; }
  tiles(d.overview); dueList(d.overview.refundsDue);
  const note = $('stripe-note');
  note.hidden = false;
  note.textContent = d.stripe.ready ? `Card payments run through Stripe in ${d.stripe.mode} mode.${d.stripe.webhook ? '' : ' Webhook secret missing: payments will only update when the customer returns to the site.'}` : 'Card payments are not connected yet. Add your Stripe keys to the .env file (see the README).';
  note.className = d.stripe.ready && d.stripe.webhook ? 'alert alert--dev' : 'alert alert--error';
  $('p-sum').textContent = `In this range: received ${formatMoney(d.collectedCents)}, refunded ${formatMoney(d.refundedCents)}, net ${formatMoney(d.netCents)}`;
  const rows = $('pay-rows'); rows.replaceChildren();
  if (!d.payments.length) { const tr = document.createElement('tr'); const c = td('No payments in this range.'); c.colSpan = 7; tr.appendChild(c); rows.appendChild(tr); }
  d.payments.forEach((p) => {
    const tr = document.createElement('tr');
    const st = document.createElement('td'); st.appendChild(badge('status', p.status)); if (p.failure_reason) st.title = p.failure_reason;
    tr.append(td(sydneyTime(p.created_at)), td(p.reference), td(p.customer_name), td(p.kind === 'refund' ? 'Refund' : 'Payment'), td(p.method), td(`${p.kind === 'refund' ? '−' : ''}${formatMoney(p.amount_cents)}`), st);
    rows.appendChild(tr);
  });
  const pages = Math.max(1, Math.ceil(d.total / SIZE));
  $('page-info').textContent = `Page ${page} of ${pages} (${d.total})`;
  $('prev').disabled = page <= 1; $('more').disabled = page >= pages;
  if (me.role === 'owner') { const q = query(); q.delete('page'); q.delete('pageSize'); q.delete('kind'); $('export').href = `/api/admin/payments/export?${q}`; $('export').hidden = false; }
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  me = await requireAdmin(); if (!me) return;
  ['p-from', 'p-to', 'p-kind'].forEach((id) => $(id).addEventListener('change', () => { page = 1; load().catch((e) => toast(e.message, 'error')); }));
  $('prev').addEventListener('click', () => { page -= 1; load(); });
  $('more').addEventListener('click', () => { page += 1; load(); });
  try { await load(); } catch (e) { toast(e.message, 'error'); }
});
