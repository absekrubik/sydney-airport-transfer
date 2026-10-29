import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { formatMoney, toast, confirmDialog } from '../../../public/assets/js/ui/ui.js';
import { badge, sydneyTime } from './admin-util.js';

let page = 1; let total = 0; const SIZE = 25; let timer;
const $ = (id) => document.getElementById(id);
const cell = (text) => { const c = document.createElement('td'); c.textContent = text; return c; };

async function load() {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(SIZE) });
  if ($('f-status').value) qs.set('status', $('f-status').value);
  if ($('f-q').value.trim()) qs.set('q', $('f-q').value.trim());
  const rows = $('booking-rows');
  try {
    const data = await api('GET', `/api/admin/bookings?${qs}`);
    total = data.total; rows.replaceChildren();
    if (!data.bookings.length) { const tr = document.createElement('tr'); const c = cell('No bookings match.'); c.colSpan = 8; tr.appendChild(c); rows.appendChild(tr); }
    data.bookings.forEach((b) => {
      const tr = document.createElement('tr');
      const ref = document.createElement('td'); const link = document.createElement('button'); link.type = 'button'; link.className = 'link-arrow'; link.textContent = b.reference;
      link.addEventListener('click', () => showDetail(b.id)); ref.appendChild(link);
      const st = document.createElement('td'); st.appendChild(badge('status', b.status));
      const pay = document.createElement('td'); pay.appendChild(badge('payment', b.payment_status));
      tr.append(ref, cell(b.customer_name), cell(sydneyTime(b.first_pickup_at)), cell(b.route || '—'), cell(b.vehicle), cell(formatMoney(b.quoted_total_cents)), st, pay);
      rows.appendChild(tr);
    });
    const pages = Math.max(1, Math.ceil(total / SIZE));
    $('page-info').textContent = `Page ${page} of ${pages} (${total} bookings)`;
    $('prev').disabled = page <= 1; $('more').disabled = page >= pages;
  } catch (e) { rows.replaceChildren(); const tr = document.createElement('tr'); const c = cell(e.message); c.colSpan = 8; tr.appendChild(c); rows.appendChild(tr); }
}

const STAGES = { confirmed: ['en_route', 'Mark driver on the way'], en_route: ['in_progress', 'Passenger picked up'], in_progress: ['completed', 'Mark trip completed'] };
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
let drivers = [];
let me = null;

async function act(fn, done) {
  try { await fn(); if (done) toast(done, 'success'); } catch (e) { toast(e.message, 'error'); }
}

async function showDetail(id) {
  const [{ booking: b, legs, history, payments, paymentSummary: ps }, dr] = await Promise.all([api('GET', `/api/admin/bookings/${id}`), api('GET', '/api/admin/drivers')]);
  drivers = dr.drivers.filter((d) => d.active);
  const refresh = async () => { await showDetail(id); load(); };
  $('detail-title').textContent = `Booking ${b.reference}`;
  const body = $('detail-body'); body.replaceChildren();
  const dl = document.createElement('dl'); dl.className = 'review';
  const add = (t, v) => { const dt = document.createElement('dt'); dt.textContent = t; const dd = document.createElement('dd'); dd.textContent = v || '—'; dl.append(dt, dd); };
  add('Customer', `${b.customer_name}, ${b.customer_phone}, ${b.customer_email}`);
  add('Status', `${b.status} (payment ${b.payment_status}, preference ${b.payment_preference})`);
  add('Vehicle', `${b.vehicle}, ${b.passengers} passengers, ${b.luggage} bags, ${b.child_seats} child seats`);
  if (b.flight_number) add('Flight', b.flight_number);
  if (b.notes_customer) add('Customer notes', b.notes_customer);
  add('Total', `${formatMoney(b.quoted_total_cents)} (GST ${formatMoney(b.gst_cents)})`);
  (b.quote_breakdown?.lines || []).forEach((l) => add(`  ${l.label}`, formatMoney(l.cents)));
  body.appendChild(dl);

  // Booking-level actions
  const row = el('div', 'actions-row');
  const btn = (label, cls, fn) => { const x = el('button', `btn ${cls} btn--sm`, label); x.type = 'button'; x.addEventListener('click', fn); return x; };
  const setStatus = (to, label, cls, ask) => btn(label, cls, async () => {
    let reason = '';
    if (ask) {
      if (!(await confirmDialog({ title: ask.title, message: ask.message, confirmLabel: label, danger: true }))) return;
      reason = ask.reason;
    }
    await act(() => api('POST', `/api/admin/bookings/${b.id}/status`, { status: to, reason }), `Booking ${to}.`); refresh();
  });
  if (b.status === 'pending') row.append(setStatus('confirmed', 'Confirm booking', 'btn--primary'), setStatus('declined', 'Decline', 'btn--ghost', { title: 'Decline this booking?', message: 'The customer’s trips will be cancelled and any card payment refunded in full.', reason: 'Declined by staff' }));
  if (['pending', 'confirmed'].includes(b.status)) row.append(setStatus('cancelled', 'Cancel booking', 'btn--ghost', { title: 'Cancel this booking?', message: 'All trips will be cancelled and anything the customer paid by card is refunded in full. No cancellation fee is recorded when staff cancel.', reason: 'Cancelled by staff' }));
  if (row.children.length) body.appendChild(row);

  // One box per trip: driver and stage
  legs.forEach((l) => {
    const box = el('div', 'legbox');
    box.appendChild(el('h3', '', `Trip ${l.leg_number}: ${l.leg_status.replace('_', ' ')}`));
    box.appendChild(el('p', 'text-muted', `${sydneyTime(l.pickup_at)}: ${l.pickup_address} → ${l.dropoff_address}`));
    const closed = ['declined', 'cancelled', 'completed'].includes(b.status) || ['completed', 'cancelled', 'no_show'].includes(l.leg_status);
    if (closed) {
      box.appendChild(el('p', '', `Driver: ${l.driver_name ? `${l.driver_name} (${l.driver_phone})` : 'none'}`));
    } else {
      const r = el('div', 'row');
      const sel = el('select', 'select'); sel.setAttribute('aria-label', `Driver for trip ${l.leg_number}`);
      sel.appendChild(Object.assign(el('option', '', 'No driver assigned'), { value: '' }));
      drivers.forEach((d) => sel.appendChild(Object.assign(el('option', '', d.fullName), { value: String(d.id), selected: d.id === l.driver_id })));
      sel.addEventListener('change', async () => {
        const driverId = sel.value ? Number(sel.value) : null;
        const send = (force) => api('POST', `/api/admin/bookings/${b.id}/legs/${l.leg_number}/driver`, { driverId, force });
        try { await send(false); toast(driverId ? 'Driver assigned.' : 'Driver removed.', 'success'); }
        catch (e) {
          if (e.code === 'DRIVER_BUSY' && (await confirmDialog({ title: 'Driver already busy', message: `${e.message} Assign anyway?`, confirmLabel: 'Assign anyway' }))) await act(() => send(true), 'Driver assigned.');
          else if (e.code !== 'DRIVER_BUSY') toast(e.message, 'error');
        }
        refresh();
      });
      r.appendChild(sel);
      if (l.driver_phone) r.appendChild(el('span', 'text-muted', `${l.driver_phone}${l.driver_vehicle ? ` · ${l.driver_vehicle}` : ''}`));
      box.appendChild(r);
      if (b.status === 'confirmed' && STAGES[l.leg_status]) {
        const [to, label] = STAGES[l.leg_status];
        const r2 = el('div', 'row');
        r2.appendChild(btn(label, 'btn--navy', async () => { await act(() => api('POST', `/api/admin/bookings/${b.id}/legs/${l.leg_number}/status`, { status: to }), 'Trip updated.'); refresh(); }));
        if (['confirmed', 'en_route'].includes(l.leg_status)) r2.appendChild(btn('Passenger no-show', 'btn--ghost', async () => {
          if (!(await confirmDialog({ title: 'Mark as no-show?', message: 'Use this when the passenger did not turn up.', confirmLabel: 'Mark no-show', danger: true }))) return;
          await act(() => api('POST', `/api/admin/bookings/${b.id}/legs/${l.leg_number}/status`, { status: 'no_show' }), 'Marked as no-show.'); refresh();
        }));
        box.appendChild(r2);
      }
    }
    body.appendChild(box);
  });

  // Payments: what has been paid, manual records (cash/bank), and card refunds
  const pbox = el('div', 'paybox');
  pbox.appendChild(el('h3', '', 'Payments'));
  const money = document.createElement('dl'); money.className = 'review';
  const addm = (t, v) => { money.append(el('dt', '', t), el('dd', '', v)); };
  addm('Booking total', formatMoney(b.quoted_total_cents)); addm('Received', formatMoney(ps.paid)); if (ps.refunded) addm('Refunded', formatMoney(ps.refunded));
  addm('Still to collect', formatMoney(Math.max(0, b.quoted_total_cents - ps.net)));
  pbox.appendChild(money);
  payments.forEach((p) => pbox.appendChild(el('p', 'text-muted', `${sydneyTime(p.created_at)}: ${p.kind === 'refund' ? 'Refund' : 'Payment'} ${formatMoney(p.amount_cents)} by ${p.method} (${p.status})${p.note ? `, ${p.note}` : ''}${p.failure_reason ? `, ${p.failure_reason}` : ''}`)));
  const rec = el('div', 'row');
  const kind = el('select', 'select'); kind.setAttribute('aria-label', 'Type');
  kind.appendChild(Object.assign(el('option', '', 'Payment received'), { value: 'payment' }));
  if (me.role === 'owner') kind.appendChild(Object.assign(el('option', '', 'Cash/bank refund'), { value: 'refund' }));
  const method = el('select', 'select'); method.setAttribute('aria-label', 'Method');
  [['cash', 'Cash'], ['bank', 'Bank transfer'], ['other', 'Other']].forEach(([v, t]) => method.appendChild(Object.assign(el('option', '', t), { value: v })));
  const amt = Object.assign(el('input', 'input'), { type: 'number', min: '0.01', step: '0.01', placeholder: 'Amount $' }); amt.setAttribute('aria-label', 'Amount in dollars'); amt.style.width = '150px';
  const note = Object.assign(el('input', 'input'), { type: 'text', maxLength: 200, placeholder: 'Note (optional)' }); note.setAttribute('aria-label', 'Note');
  rec.append(kind, method, amt, note, btn('Record', 'btn--navy', async () => {
    const cents = Math.round(parseFloat(amt.value) * 100);
    if (!Number.isInteger(cents) || cents < 1) { toast('Enter an amount.', 'error'); return; }
    await act(() => api('POST', `/api/admin/bookings/${b.id}/payments`, { kind: kind.value, method: method.value, amountCents: cents, note: note.value }), 'Recorded.'); refresh();
  }));
  pbox.appendChild(rec);
  if (me.role === 'owner' && ps.refundableCardCents > 0) {
    const r2 = el('div', 'row');
    const ra = Object.assign(el('input', 'input'), { type: 'number', min: '0.01', step: '0.01', value: (ps.refundableCardCents / 100).toFixed(2) }); ra.setAttribute('aria-label', 'Card refund amount in dollars'); ra.style.width = '120px';
    r2.append(el('span', 'text-muted', `Refund to card (up to ${formatMoney(ps.refundableCardCents)}):`), ra, btn('Refund card', 'btn--ghost', async () => {
      const cents = Math.round(parseFloat(ra.value) * 100);
      if (!Number.isInteger(cents) || cents < 1) { toast('Enter an amount.', 'error'); return; }
      if (!(await confirmDialog({ title: 'Refund to card?', message: `${formatMoney(cents)} goes back to the customer’s card. This cannot be undone.`, confirmLabel: 'Refund', danger: true }))) return;
      await act(() => api('POST', `/api/admin/bookings/${b.id}/refund`, { amountCents: cents }), 'Refund sent.'); refresh();
    }));
    pbox.appendChild(r2);
  }
  body.appendChild(pbox);

  // Internal notes (never shown to the customer)
  const nl = el('label', '', 'Internal notes (staff only)'); nl.htmlFor = 'int-notes'; nl.style.cssText = 'display:block;margin-top:var(--sp-4);font-weight:600;font-size:var(--fs-sm)';
  const ta = Object.assign(el('textarea', 'textarea'), { id: 'int-notes', rows: 2, maxLength: 1000, value: b.notes_internal || '' });
  const sv = btn('Save note', 'btn--ghost', async () => { await act(() => api('PUT', `/api/admin/bookings/${b.id}/notes`, { notes: ta.value }), 'Note saved.'); });
  sv.style.marginTop = 'var(--sp-2)';
  body.append(nl, ta, sv);

  const hl = el('h3', '', 'History'); hl.style.marginTop = 'var(--sp-4)'; body.appendChild(hl);
  const hd = document.createElement('dl'); hd.className = 'review';
  history.forEach((h) => { const dt = el('dt', '', `${sydneyTime(h.created_at)}: ${(h.from_status || 'new').replace('_', ' ')} → ${h.to_status.replace('_', ' ')}`); const dd = el('dd', '', h.reason || '—'); hd.append(dt, dd); });
  body.appendChild(hd);
  if (!$('detail').open) $('detail').showModal();
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  me = await requireAdmin(); if (!me) return;
  $('f-status').addEventListener('change', () => { page = 1; load(); });
  $('f-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; load(); }, 300); });
  $('prev').addEventListener('click', () => { page -= 1; load(); });
  $('more').addEventListener('click', () => { page += 1; load(); });
  $('detail-close').addEventListener('click', () => $('detail').close());
  load();
});
