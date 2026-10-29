// Admin > Pricing: fixed fares per route and vehicle, return discount, child seat price, cancellation percentage.
import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { toast } from '../../../public/assets/js/ui/ui.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const dollars = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace(/\.00$/, ''));
const toCents = (s) => (s.trim() === '' ? null : Math.round(Number(s) * 100));

let data = null;
const dirty = new Map(); // "pair|vehicle" -> { fromId, toId, vehicle, cents }
const rateDirty = new Map(); // vehicle code -> { vehicle, baseCents, perKmCents, minCents }

function renderRates() {
  $('p-dist-on').checked = data.distanceEnabled; $('p-routing').hidden = data.routingReady;
  const body = $('rate-rows'); body.replaceChildren();
  for (const v of data.vehicles) {
    const cur = data.rates[v.code]; const tr = el('tr'); tr.appendChild(el('td', '', v.name));
    const inputs = ['baseCents', 'perKmCents', 'minCents'].map((k) => {
      const i = el('input', 'input'); Object.assign(i, { type: 'number', min: 0, max: 10000, step: '0.01', inputMode: 'decimal', value: dollars(cur?.[k]), placeholder: '—' });
      i.setAttribute('aria-label', `${v.name}, ${{ baseCents: 'base fee', perKmCents: 'price per km', minCents: 'minimum fare' }[k]}, dollars`);
      const td = el('td'); const wrap = el('div', 'fare-in'); wrap.append(el('span', '', '$'), i); td.appendChild(wrap); tr.appendChild(td); return i;
    });
    const changed = () => {
      const [b, k, m] = inputs.map((i) => toCents(i.value));
      const same = cur ? b === cur.baseCents && k === cur.perKmCents && m === cur.minCents : b === null && k === null && m === null;
      inputs.forEach((i) => i.classList.toggle('is-changed', !same));
      if (same) rateDirty.delete(v.code); else rateDirty.set(v.code, { vehicle: v.code, baseCents: b, perKmCents: k, minCents: m });
      status();
    };
    inputs.forEach((i) => i.addEventListener('input', changed));
    body.appendChild(tr);
  }
}

function render() {
  renderRates();
  $('p-return').value = data.returnDiscountPercent;
  $('p-seat').value = dollars(data.childSeatCents) || '0';
  $('p-cancel').value = data.cancellationPercent;
  $('p-version').textContent = `Pricing version ${data.version}`;
  $('p-sample').hidden = !data.isSample;
  const head = $('fare-head'); head.replaceChildren(el('th', '', 'Route'), ...data.vehicles.map((v) => el('th', '', v.name)));
  const body = $('fare-rows'); body.replaceChildren();
  for (const r of data.routes) {
    const tr = el('tr'); tr.appendChild(el('td', '', `${r.from} ⇄ ${r.to}`));
    for (const v of data.vehicles) {
      const td = el('td'); const wrap = el('div', 'fare-in');
      const cur = data.fares[`${r.key}|${v.code}`];
      const i = el('input', 'input'); Object.assign(i, { type: 'number', min: 1, max: 50000, step: '0.01', inputMode: 'decimal', value: dollars(cur), placeholder: '—' });
      i.setAttribute('aria-label', `${r.from} to ${r.to}, ${v.name}, fare in dollars`);
      i.addEventListener('input', () => {
        const k = `${r.key}|${v.code}`; const c = toCents(i.value);
        if (c === (cur ?? null)) { dirty.delete(k); i.classList.remove('is-changed'); } else { dirty.set(k, { fromId: r.fromId, toId: r.toId, vehicle: v.code, cents: c }); i.classList.add('is-changed'); }
        status();
      });
      wrap.append(el('span', '', '$'), i); td.appendChild(wrap); tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function rulesChanged() {
  return Number($('p-return').value) !== data.returnDiscountPercent || toCents($('p-seat').value) !== data.childSeatCents || Number($('p-cancel').value) !== data.cancellationPercent || $('p-dist-on').checked !== data.distanceEnabled;
}
function status() {
  const n = dirty.size + rateDirty.size + (rulesChanged() ? 1 : 0);
  $('save-state').textContent = n ? 'You have unsaved changes.' : 'No changes.';
  $('save').disabled = !n;
}

async function save() {
  $('save').disabled = true;
  try {
    const res = await api('PUT', '/api/admin/pricing', {
      returnDiscountPercent: $('p-return').value, childSeatCents: toCents($('p-seat').value) ?? 0, cancellationPercent: $('p-cancel').value,
      fares: [...dirty.values()], distanceEnabled: $('p-dist-on').checked, rates: [...rateDirty.values()],
    });
    data = res.pricing; dirty.clear(); rateDirty.clear(); render(); status();
    toast(`Saved as pricing version ${res.version}. New quotes use these prices now.`, 'success');
  } catch (e) {
    toast(e.fields ? Object.values(e.fields)[0] : e.message, 'error'); $('save').disabled = false;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  if (!(await requireAdmin())) return;
  try { data = await api('GET', '/api/admin/pricing'); } catch (e) { $('fare-rows').replaceChildren(); $('p-error').hidden = false; $('p-error').textContent = e.message; return; }
  render(); status();
  ['p-return', 'p-seat', 'p-cancel', 'p-dist-on'].forEach((id) => $(id).addEventListener('input', status));
  $('save').addEventListener('click', save);
  $('discard').addEventListener('click', () => { dirty.clear(); rateDirty.clear(); render(); status(); });
});
