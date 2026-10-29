// Admin > Promotions: discount codes customers can enter when booking.
import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { toast, confirmDialog, formatMoney } from '../../../public/assets/js/ui/ui.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const day = (iso) => (iso ? new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '');
const inputDate = (iso) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(iso)) : '');

function describe(p) { return p.type === 'percent' ? `${p.value}% off` : `${formatMoney(p.value)} off`; }
function status(p) {
  const now = Date.now();
  if (!p.active) return 'Off';
  if (p.validTo && new Date(p.validTo) < now) return 'Expired';
  if (p.validFrom && new Date(p.validFrom) > now) return 'Scheduled';
  if (p.maxUses != null && p.uses >= p.maxUses) return 'Used up';
  return 'Live';
}

function promoDialog(p) {
  return new Promise((resolve) => {
    const dlg = el('dialog', 'dialog'); dlg.style.width = 'min(94vw, 480px)';
    const form = el('form'); form.noValidate = true; form.appendChild(el('h3', '', p ? `Edit ${p.code}` : 'New promo code'));
    const refs = {};
    const field = (key, label, make, hint) => {
      const w = el('div', 'field'); w.style.marginTop = 'var(--sp-3)';
      const l = el('label', '', label); l.htmlFor = `p-${key}`; const i = make(); i.id = `p-${key}`;
      const err = el('p'); err.style.cssText = 'color:var(--danger);font-size:var(--fs-xs);margin:0';
      w.append(l, i); if (hint) { const h = el('p', 'text-muted', hint); h.style.cssText = 'font-size:var(--fs-xs);margin:0'; w.appendChild(h); } w.appendChild(err); form.appendChild(w); refs[key] = { i, err };
    };
    const input = (type, value, extra = {}) => () => Object.assign(el('input', 'input'), { type, value: value ?? '', ...extra });
    if (!p) {
      field('code', 'Code customers type', input('text', '', { maxLength: 30, placeholder: 'e.g. WELCOME10', style: 'text-transform:uppercase' }));
      field('type', 'Type of discount', () => { const s = el('select', 'select'); s.append(Object.assign(el('option', '', 'Percentage off'), { value: 'percent' }), Object.assign(el('option', '', 'Dollar amount off'), { value: 'fixed' })); return s; });
    }
    const type = p ? p.type : 'percent';
    field('value', type === 'fixed' ? 'Amount off ($)' : 'Percentage off (%)', input('number', p ? (p.type === 'fixed' ? p.value / 100 : p.value) : '', { min: 1, step: p?.type === 'fixed' ? '0.01' : '1' }));
    field('minFare', 'Minimum fare to use it ($, optional)', input('number', p ? p.minFareCents / 100 : '', { min: 0, step: '0.01', placeholder: '0' }));
    field('maxUses', 'Total uses allowed (optional)', input('number', p?.maxUses ?? '', { min: 1, step: '1', placeholder: 'Unlimited' }));
    field('validFrom', 'Starts (optional)', input('date', inputDate(p?.validFrom)));
    field('validTo', 'Ends (optional)', input('date', inputDate(p?.validTo)), 'The code works up to the end of this day, Sydney time.');
    if (!p) refs.type.i.addEventListener('change', () => { const fixed = refs.type.i.value === 'fixed'; refs.value.i.previousSibling.textContent = fixed ? 'Amount off ($)' : 'Percentage off (%)'; refs.value.i.step = fixed ? '0.01' : '1'; });
    const msg = el('p'); msg.style.cssText = 'color:var(--danger);font-size:var(--fs-sm);margin:var(--sp-3) 0 0';
    const actions = el('div', 'dialog__actions');
    const cancel = el('button', 'btn btn--ghost', 'Cancel'); cancel.type = 'button';
    const save = el('button', 'btn btn--primary', p ? 'Save changes' : 'Create code'); save.type = 'submit';
    actions.append(cancel, save); form.append(msg, actions); dlg.appendChild(form); document.body.appendChild(dlg);
    const close = (r) => { dlg.close(); dlg.remove(); resolve(r); };
    cancel.addEventListener('click', () => close(false)); dlg.addEventListener('cancel', () => close(false));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); msg.textContent = ''; Object.values(refs).forEach((r) => { r.err.textContent = ''; });
      const t = p ? p.type : refs.type.i.value;
      const money = (v) => (v === '' ? 0 : Math.round(Number(v) * 100));
      const body = {
        value: t === 'fixed' ? undefined : refs.value.i.value, valueCents: t === 'fixed' ? money(refs.value.i.value) : undefined,
        minFareCents: money(refs.minFare.i.value), maxUses: refs.maxUses.i.value === '' ? null : refs.maxUses.i.value,
        validFrom: refs.validFrom.i.value || null, validTo: refs.validTo.i.value || null,
      };
      if (t === 'fixed') body.value = money(refs.value.i.value);
      if (!p) { body.code = refs.code.i.value; body.type = t; }
      save.disabled = true;
      try { close(await (p ? api('PATCH', `/api/admin/promotions/${p.id}`, body) : api('POST', '/api/admin/promotions', body))); }
      catch (err) {
        const map = { code: 'code', type: 'type', value: 'value', minFareCents: 'minFare', maxUses: 'maxUses', validFrom: 'validFrom', validTo: 'validTo' };
        let shown = false; for (const [k, m] of Object.entries(err.fields || {})) if (refs[map[k]]) { refs[map[k]].err.textContent = m; shown = true; }
        if (!shown) msg.textContent = err.message; save.disabled = false;
      }
    });
    dlg.showModal(); (refs.code || refs.value).i.focus();
  });
}

async function load() {
  const body = $('promo-rows');
  try {
    const { promotions } = await api('GET', '/api/admin/promotions');
    body.replaceChildren();
    if (!promotions.length) { const tr = el('tr'); const c = el('td', '', 'No promo codes yet. Click “New promo code” to create one.'); c.colSpan = 6; tr.appendChild(c); body.appendChild(tr); }
    promotions.forEach((p) => {
      const tr = el('tr'); const st = status(p);
      const code = el('td'); code.appendChild(el('strong', '', p.code));
      const stCell = el('td'); stCell.appendChild(el('span', `badge badge--${{ Live: 'confirmed', Off: 'cancelled', Expired: 'declined', Scheduled: 'pending', 'Used up': 'completed' }[st]}`, st));
      const dates = el('td', '', p.validFrom || p.validTo ? `${p.validFrom ? day(p.validFrom) : 'Now'} to ${p.validTo ? day(p.validTo) : 'no end'}` : 'Always');
      const uses = el('td', '', p.maxUses != null ? `${p.uses} of ${p.maxUses}` : `${p.uses}`);
      const acts = el('td'); acts.style.whiteSpace = 'nowrap';
      const mk = (label, fn) => { const b = el('button', 'btn btn--ghost btn--sm', label); b.type = 'button'; b.style.marginRight = '6px'; b.addEventListener('click', fn); return b; };
      acts.append(
        mk('Edit', async () => { if (await promoDialog(p)) { toast('Promo code updated.', 'success'); load(); } }),
        mk(p.active ? 'Switch off' : 'Switch on', async () => { try { await api('PATCH', `/api/admin/promotions/${p.id}`, { active: !p.active }); } catch (e) { toast(e.message, 'error'); } load(); }),
        mk('Delete', async () => {
          if (!(await confirmDialog({ title: `Delete ${p.code}?`, message: 'Codes that have been used cannot be deleted; switch them off instead.', confirmLabel: 'Delete code', danger: true }))) return;
          try { await api('DELETE', `/api/admin/promotions/${p.id}`); toast('Promo code deleted.', 'success'); } catch (e) { toast(e.message, 'error'); } load();
        }),
      );
      tr.append(code, el('td', '', describe(p) + (p.minFareCents ? ` (min ${formatMoney(p.minFareCents)})` : '')), dates, uses, stCell, acts);
      body.appendChild(tr);
    });
  } catch (e) { body.replaceChildren(); const tr = el('tr'); const c = el('td', '', e.message); c.colSpan = 6; tr.appendChild(c); body.appendChild(tr); }
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  if (!(await requireAdmin())) return;
  $('add-promo').addEventListener('click', async () => { if (await promoDialog(null)) { toast('Promo code created.', 'success'); load(); } });
  load();
});
