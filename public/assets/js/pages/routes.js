import { formatMoney } from '../ui/ui.js';
import { api } from '../api.js';
import { initCommon } from '../common.js';

const cell = (text) => { const td = document.createElement('td'); td.textContent = text; return td; };

async function render() {
  const body = document.getElementById('route-rows');
  let vehicles; let data;
  try { [{ vehicles }, data] = await Promise.all([api('GET', '/api/vehicle-categories'), api('GET', '/api/routes')]); }
  catch (e) { const tr = document.createElement('tr'); const td = cell(e.message); td.colSpan = 6; tr.appendChild(td); body.appendChild(tr); return; }

  const headRow = body.closest('table').querySelector('thead tr');
  headRow.replaceChildren();
  ['Route', ...vehicles.map((v) => v.name)].forEach((t) => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = t; headRow.appendChild(th); });
  const last = document.createElement('th'); const hidden = document.createElement('span'); hidden.className = 'visually-hidden'; hidden.textContent = 'Book'; last.appendChild(hidden); headRow.appendChild(last);

  data.routes.filter((r) => /International/.test(r.from)).forEach((r) => {
    const tr = document.createElement('tr');
    tr.appendChild(cell(`${r.from.split(' (')[0]} to ${r.to}`));
    vehicles.forEach((v) => tr.appendChild(cell(r.fares[v.code] ? formatMoney(r.fares[v.code]) : '—')));
    const action = document.createElement('td');
    const link = document.createElement('a'); link.className = 'link-arrow'; link.textContent = 'Book';
    link.href = `booking.html?pickup=${encodeURIComponent(r.from)}&destination=${encodeURIComponent(r.to)}`;
    action.appendChild(link); tr.appendChild(action); body.appendChild(tr);
  });
  const note = document.getElementById('routes-sample'); if (note) note.hidden = !data.sample;
}

window.addEventListener('DOMContentLoaded', async () => { await render(); initCommon(); });
