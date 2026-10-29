// Admin > Drivers: people who drive the trips. Records only; drivers do not log in.
import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { toast, confirmDialog } from '../../../public/assets/js/ui/ui.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
let vehicles = [];

function driverDialog(d) {
  return new Promise((resolve) => {
    const dlg = el('dialog', 'dialog'); dlg.style.width = 'min(94vw, 480px)';
    const form = el('form'); form.noValidate = true; form.appendChild(el('h3', '', d ? `Edit ${d.fullName}` : 'Add a driver'));
    const refs = {};
    const field = (key, label, make) => {
      const w = el('div', 'field'); w.style.marginTop = 'var(--sp-3)';
      const l = el('label', '', label); l.htmlFor = `d-${key}`;
      const i = make(); i.id = `d-${key}`;
      const err = el('p'); err.style.cssText = 'color:var(--danger);font-size:var(--fs-xs);margin:0';
      w.append(l, i, err); form.appendChild(w); refs[key] = { i, err };
    };
    const input = (type, value, extra = {}) => () => Object.assign(el('input', 'input'), { type, value: value || '', ...extra });
    field('fullName', 'Full name', input('text', d?.fullName, { maxLength: 80 }));
    field('phone', 'Mobile phone', input('tel', d?.phone, { maxLength: 30, placeholder: '04xx xxx xxx' }));
    field('email', 'Email (optional)', input('email', d?.email, { maxLength: 120 }));
    field('vehicleCode', 'Drives (vehicle type)', () => {
      const s = el('select', 'select'); s.appendChild(Object.assign(el('option', '', 'Not set'), { value: '' }));
      vehicles.forEach((v) => s.appendChild(Object.assign(el('option', '', v.name), { value: v.code, selected: v.code === d?.vehicleCode })));
      return s;
    });
    field('vehicleDetails', 'Car details (optional)', input('text', d?.vehicleDetails, { maxLength: 120, placeholder: 'e.g. White Camry, ABC123' }));
    field('notes', 'Notes (optional)', () => Object.assign(el('textarea', 'textarea'), { rows: 2, maxLength: 500, value: d?.notes || '' }));
    const msg = el('p'); msg.style.cssText = 'color:var(--danger);font-size:var(--fs-sm);margin:var(--sp-3) 0 0';
    const actions = el('div', 'dialog__actions');
    const cancel = el('button', 'btn btn--ghost', 'Cancel'); cancel.type = 'button';
    const save = el('button', 'btn btn--primary', d ? 'Save changes' : 'Add driver'); save.type = 'submit';
    actions.append(cancel, save); form.append(msg, actions); dlg.appendChild(form); document.body.appendChild(dlg);
    const close = (r) => { dlg.close(); dlg.remove(); resolve(r); };
    cancel.addEventListener('click', () => close(false)); dlg.addEventListener('cancel', () => close(false));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); msg.textContent = ''; Object.values(refs).forEach((r) => { r.err.textContent = ''; });
      const body = Object.fromEntries(Object.entries(refs).map(([k, r]) => [k, r.i.value]));
      save.disabled = true;
      try { close(await (d ? api('PATCH', `/api/admin/drivers/${d.id}`, body) : api('POST', '/api/admin/drivers', body))); }
      catch (err) {
        let shown = false;
        for (const [k, m] of Object.entries(err.fields || {})) if (refs[k]) { refs[k].err.textContent = m; shown = true; }
        if (!shown) msg.textContent = err.message; save.disabled = false;
      }
    });
    dlg.showModal(); refs.fullName.i.focus();
  });
}

function row(d) {
  const tr = el('tr'); if (!d.active) tr.style.opacity = '.6';
  const name = el('td'); name.append(el('strong', '', d.fullName)); if (!d.active) name.append(el('span', 'text-muted', ' (inactive)'));
  const contact = el('td', '', d.phone); if (d.email) { contact.appendChild(el('br')); contact.appendChild(el('span', 'text-muted', d.email)); }
  const car = el('td', '', [d.vehicleName, d.vehicleDetails].filter(Boolean).join(' · ') || '—');
  const acts = el('td'); acts.style.whiteSpace = 'nowrap';
  const mk = (label, fn) => { const b = el('button', 'btn btn--ghost btn--sm', label); b.type = 'button'; b.style.marginRight = '6px'; b.addEventListener('click', fn); return b; };
  acts.append(
    mk('Edit', async () => { if (await driverDialog(d)) { toast('Driver updated.', 'success'); load(); } }),
    mk(d.active ? 'Make inactive' : 'Make active', async () => { try { await api('PATCH', `/api/admin/drivers/${d.id}`, { active: !d.active }); } catch (e) { toast(e.message, 'error'); } load(); }),
    mk('Delete', async () => {
      if (!(await confirmDialog({ title: `Delete ${d.fullName}?`, message: 'Drivers who have been assigned to trips cannot be deleted; make them inactive instead.', confirmLabel: 'Delete driver', danger: true }))) return;
      try { await api('DELETE', `/api/admin/drivers/${d.id}`); toast('Driver deleted.', 'success'); } catch (e) { toast(e.message, 'error'); } load();
    }),
  );
  tr.append(name, contact, car, el('td', '', String(d.upcoming)), acts);
  return tr;
}

async function load() {
  const body = $('driver-rows');
  try {
    const { drivers } = await api('GET', '/api/admin/drivers');
    body.replaceChildren();
    if (!drivers.length) { const tr = el('tr'); const c = el('td', '', 'No drivers yet. Click “Add driver” to create the first one.'); c.colSpan = 5; tr.appendChild(c); body.appendChild(tr); }
    drivers.forEach((d) => body.appendChild(row(d)));
  } catch (e) { body.replaceChildren(); const tr = el('tr'); const c = el('td', '', e.message); c.colSpan = 5; tr.appendChild(c); body.appendChild(tr); }
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  if (!(await requireAdmin())) return;
  try { vehicles = (await api('GET', '/api/admin/vehicles')).vehicles; } catch { vehicles = []; }
  $('add-driver').addEventListener('click', async () => { if (await driverDialog(null)) { toast('Driver added.', 'success'); load(); } });
  load();
});
