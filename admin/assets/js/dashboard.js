import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { formatMoney } from '../../../public/assets/js/ui/ui.js';
import { badge, sydneyTime } from './admin-util.js';

const CARDS = [['Total bookings', 'totalBookings'], ['Pending bookings', 'pendingBookings'], ['Confirmed bookings', 'confirmedBookings'], ["Today's trips", 'todaysTrips'],
  ['Completed trips', 'completedTrips'], ['Cancelled bookings', 'cancelledBookings'], ['Recorded revenue', 'recordedRevenue'], ['Pending payments', 'pendingPayments'], ['Upcoming transfers (7 days)', 'upcomingTransfers']];

const td = (text, cls) => { const c = document.createElement('td'); c.textContent = text; if (cls) c.className = cls; return c; };

async function load() {
  const [stats, list] = await Promise.all([api('GET', '/api/admin/dashboard/stats'), api('GET', '/api/admin/bookings?pageSize=8')]);
  const grid = document.getElementById('stat-grid'); grid.replaceChildren();
  CARDS.forEach(([label, key]) => {
    const card = document.createElement('div'); card.className = 'stat';
    const lab = document.createElement('div'); lab.className = 'stat__label'; lab.textContent = label;
    const val = document.createElement('div'); val.className = 'stat__value';
    const v = stats[key];
    val.textContent = v === null ? '—' : key === 'recordedRevenue' || key === 'pendingPayments' ? formatMoney(v) : String(v);
    if (v === null) val.title = "Not available";
    card.append(lab, val); grid.appendChild(card);
  });
  const rows = document.getElementById('recent-rows'); rows.replaceChildren();
  if (!list.bookings.length) { const tr = document.createElement('tr'); const c = td('No bookings yet. They appear here as customers book.'); c.colSpan = 5; tr.appendChild(c); rows.appendChild(tr); }
  list.bookings.forEach((b) => {
    const tr = document.createElement('tr');
    const ref = td(b.reference); const pay = document.createElement('td'); pay.appendChild(badge('payment', b.payment_status));
    const st = document.createElement('td'); st.appendChild(badge('status', b.status));
    tr.append(ref, td(sydneyTime(b.first_pickup_at)), td(b.route || '—'), st, pay); rows.appendChild(tr);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  if (!(await requireAdmin())) return;
  try { await load(); } catch (e) { const n = document.getElementById('dash-note'); n.textContent = e.message; n.hidden = false; }
});
