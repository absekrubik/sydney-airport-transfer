// Admin > Reports (owner only): bookings, money and popular routes for a date range.
import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { formatMoney, toast } from '../../../public/assets/js/ui/ui.js';

const $ = (id) => document.getElementById(id);
const td = (text) => { const c = document.createElement('td'); c.textContent = text; return c; };
const PREF = { card_online: 'Pay online by card', deposit: 'Deposit online', cash_to_driver: 'Pay the driver' };

function fillRows(id, rows, empty = 'Nothing yet') {
  const body = $(id); body.replaceChildren();
  if (!rows.length) { const tr = document.createElement('tr'); const c = td(empty); c.colSpan = 3; tr.appendChild(c); body.appendChild(tr); return; }
  rows.forEach((cells) => { const tr = document.createElement('tr'); cells.forEach((c) => tr.appendChild(td(c))); body.appendChild(tr); });
}

function render(r) {
  $('r-range').textContent = `${r.range.from} to ${r.range.to} (Sydney time)`;
  const t = r.totals; const grid = $('r-stats'); grid.replaceChildren();
  [['Bookings made', String(t.bookings)], ['Booked value', formatMoney(t.bookedValueCents)], ['Average fare', formatMoney(t.averageFareCents)], ['Money received', formatMoney(t.collectedCents)],
    ['Refunded', formatMoney(t.refundedCents)], ['Net received', formatMoney(t.netCents)], ['GST in net received', formatMoney(t.gstOnNetCents)], ['Cancellation fees', formatMoney(t.cancellationFeesCents)]].forEach(([label, v]) => {
    const card = document.createElement('div'); card.className = 'stat';
    const l = document.createElement('div'); l.className = 'stat__label'; l.textContent = label;
    const val = document.createElement('div'); val.className = 'stat__value'; val.textContent = v;
    card.append(l, val); grid.appendChild(card);
  });
  $('r-per').textContent = { day: 'Day', week: 'Week starting', month: 'Month starting' }[r.group];
  const body = $('r-series'); body.replaceChildren();
  const max = Math.max(1, ...r.series.map((x) => x.bookedValueCents));
  if (!r.series.length) { const tr = document.createElement('tr'); const c = td('No activity in this range.'); c.colSpan = 5; tr.appendChild(c); body.appendChild(tr); }
  r.series.forEach((x) => {
    const tr = document.createElement('tr');
    const val = td(formatMoney(x.bookedValueCents));
    const bar = document.createElement('div'); bar.className = 'minibar'; const fill = document.createElement('span'); fill.style.width = `${Math.round((x.bookedValueCents / max) * 100)}%`; bar.appendChild(fill); val.appendChild(bar);
    tr.append(td(x.period), td(String(x.bookings)), val, td(formatMoney(x.collectedCents)), td(formatMoney(x.refundedCents)));
    body.appendChild(tr);
  });
  fillRows('r-vehicles', r.byVehicle.map((v) => [v.name, String(v.bookings), formatMoney(v.valueCents)]));
  fillRows('r-routes', r.topRoutes.map((v) => [`${v.pickup} → ${v.destination}`, String(v.bookings), formatMoney(v.valueCents)]));
  fillRows('r-status', Object.entries(r.byStatus).map(([k, n]) => [k.replace('_', ' '), String(n)]));
  fillRows('r-pref', Object.entries(r.byPayment).map(([k, n]) => [PREF[k] || k, String(n)]));
}

async function load() {
  $('rep-error').hidden = true;
  const q = new URLSearchParams({ group: $('r-group').value });
  if ($('r-from').value) q.set('from', $('r-from').value);
  if ($('r-to').value) q.set('to', $('r-to').value);
  try {
    const r = await api('GET', `/api/admin/reports?${q}`);
    if (!$('r-from').value) { $('r-from').value = r.range.from; $('r-to').value = r.range.to; }
    render(r);
    $('r-csv').href = `/api/admin/payments/export?from=${r.range.from}&to=${r.range.to}`;
  } catch (e) { $('rep-error').textContent = e.status === 403 ? 'Only the owner can see reports.' : e.message; $('rep-error').hidden = false; }
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  if (!(await requireAdmin())) return;
  $('r-go').addEventListener('click', load);
  $('r-group').addEventListener('change', load);
  load().catch((e) => toast(e.message, 'error'));
});
