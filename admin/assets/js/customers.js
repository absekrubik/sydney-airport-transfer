// Admin > Customers: everyone who has booked, with their booking history. Read-only.
import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { formatMoney } from '../../../public/assets/js/ui/ui.js';
import { badge, sydneyTime } from './admin-util.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const cell = (t) => el('td', '', t);
let page = 1; let total = 0; const SIZE = 25; let timer;

async function load() {
  const rows = $('customer-rows');
  const qs = new URLSearchParams({ page: String(page), pageSize: String(SIZE) });
  if ($('c-q').value.trim()) qs.set('q', $('c-q').value.trim());
  try {
    const data = await api('GET', `/api/admin/customers?${qs}`);
    total = data.total; rows.replaceChildren();
    if (!data.customers.length) { const tr = el('tr'); const c = cell('No customers yet. They appear here after their first booking.'); c.colSpan = 6; tr.appendChild(c); rows.appendChild(tr); }
    data.customers.forEach((c) => {
      const tr = el('tr');
      const name = el('td'); const b = el('button', 'link-arrow', c.full_name); b.type = 'button'; b.addEventListener('click', () => show(c.id)); name.appendChild(b);
      const contact = cell(c.phone); contact.appendChild(el('br')); contact.appendChild(el('span', 'text-muted', c.email));
      tr.append(name, contact, cell(String(c.bookings)), cell(formatMoney(c.value_cents)), cell(c.last_booking_at ? sydneyTime(c.last_booking_at) : '—'), cell(c.marketing_opt_in ? 'Yes' : 'No'));
      rows.appendChild(tr);
    });
    const pages = Math.max(1, Math.ceil(total / SIZE));
    $('page-info').textContent = `Page ${page} of ${pages} (${total} customers)`;
    $('prev').disabled = page <= 1; $('more').disabled = page >= pages;
  } catch (e) { rows.replaceChildren(); const tr = el('tr'); const c = cell(e.message); c.colSpan = 6; tr.appendChild(c); rows.appendChild(tr); }
}

async function show(id) {
  const { customer: c, bookings } = await api('GET', `/api/admin/customers/${id}`);
  $('detail-title').textContent = c.full_name;
  const body = $('detail-body'); body.replaceChildren();
  const dl = el('dl', 'review');
  const add = (t, v) => dl.append(el('dt', '', t), el('dd', '', v || '—'));
  add('Phone', c.phone); add('Email', c.email); add('Customer since', sydneyTime(c.created_at)); add('Marketing emails', c.marketing_opt_in ? 'Agreed' : 'Not agreed');
  body.appendChild(dl);
  body.appendChild(el('h3', '', `Bookings (${bookings.length})`));
  if (!bookings.length) body.appendChild(el('p', 'text-muted', 'No bookings.'));
  bookings.forEach((b) => {
    const row = el('div', 'legbox');
    const top = el('div', 'row'); top.append(el('strong', '', b.reference), badge('status', b.status), badge('payment', b.payment_status), el('span', 'text-muted', formatMoney(b.quoted_total_cents)));
    row.append(top, el('p', 'text-muted', `${b.vehicle} · pickup ${sydneyTime(b.first_pickup_at)}`));
    body.appendChild(row);
  });
  $('detail').showModal();
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  if (!(await requireAdmin())) return;
  $('c-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; load(); }, 300); });
  $('prev').addEventListener('click', () => { page -= 1; load(); });
  $('more').addEventListener('click', () => { page += 1; load(); });
  $('detail-close').addEventListener('click', () => $('detail').close());
  load();
});
