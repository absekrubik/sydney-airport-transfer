// Admin > Vehicles: add, edit, hide or delete vehicle types, and manage each one's photo.
import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api, apiUpload } from '../../../public/assets/js/api.js';
import { toast, confirmDialog } from '../../../public/assets/js/ui/ui.js';

const MAX_SIDE = 1600; // photos are shrunk in the browser before upload, so any phone photo works
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };

async function toJpeg(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('That file could not be read as a photo. Please use a JPG, PNG or WebP image.'); }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // flatten transparency
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('Could not prepare that photo. Try a different image.');
  return blob;
}


let allVehicles = [];

/** One dialog used both to add a new vehicle and to edit an existing one. */
function vehicleDialog(existing) {
  return new Promise((resolve) => {
    const dlg = el('dialog', 'dialog'); dlg.style.width = 'min(94vw, 520px)';
    const form = el('form'); form.noValidate = true;
    form.appendChild(el('h3', '', existing ? `Edit ${existing.name}` : 'Add a vehicle'));
    const field = (id, label, attrs, hint) => {
      const w = el('div', 'field'); w.style.marginTop = 'var(--sp-3)';
      const l = el('label', '', label); l.htmlFor = id;
      const i = el(attrs.tag || 'input', attrs.tag === 'select' ? 'select' : 'input'); delete attrs.tag; Object.assign(i, { id, name: id }, attrs);
      const err = el('p', 'field__error'); err.style.cssText = 'color:var(--danger);font-size:var(--fs-xs);margin:0;min-height:0';
      w.append(l, i); if (hint) w.appendChild(Object.assign(el('p', 'text-muted', hint), { style: 'font-size:var(--fs-xs);margin:0' })); w.appendChild(err);
      return { w, i, err };
    };
    const name = field('vname', 'Vehicle name', { type: 'text', maxLength: 60, required: true, placeholder: 'e.g. Mercedes V-Class', value: existing?.name || '' });
    const example = field('vexample', 'Example model (optional)', { type: 'text', maxLength: 80, placeholder: 'e.g. Toyota Camry or similar', value: existing?.example || '' });
    const row = el('div'); row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-3)';
    const pax = field('vpax', 'Passengers', { type: 'number', min: 1, max: 60, value: existing?.passengers ?? 3 });
    const bags = field('vbags', 'Bags', { type: 'number', min: 0, max: 60, value: existing?.luggage ?? 2 });
    row.append(pax.w, bags.w);
    const feats = field('vfeat', 'Features (one per line, optional)', { tag: 'textarea', rows: 3, placeholder: 'Free Wi-Fi\nBottled water', value: (existing?.features || []).join('\n') });
    feats.i.className = 'textarea';
    form.append(name.w, example.w, row, feats.w);
    let copy = null; let pct = null;
    if (!existing && allVehicles.length) {
      const c = field('vcopy', 'Start prices from', { tag: 'select' }, 'New vehicles need fares. This copies the fixed fares of an existing vehicle so you can adjust them later.');
      c.i.appendChild(Object.assign(el('option', '', 'No fares yet (quote on request)'), { value: '' }));
      allVehicles.forEach((v) => c.i.appendChild(Object.assign(el('option', '', v.name), { value: v.code })));
      const p = field('vpct', 'Fare compared to that vehicle (%)', { type: 'number', min: 10, max: 500, value: 100 }, '100 = same price, 120 = 20% more.');
      form.append(c.w, p.w); copy = c.i; pct = p.i;
    }
    const msg = el('p'); msg.style.cssText = 'color:var(--danger);font-size:var(--fs-sm);margin:var(--sp-3) 0 0';
    const actions = el('div', 'dialog__actions');
    const cancel = el('button', 'btn btn--ghost', 'Cancel'); cancel.type = 'button';
    const save = el('button', 'btn btn--primary', existing ? 'Save changes' : 'Add vehicle'); save.type = 'submit';
    actions.append(cancel, save); form.append(msg, actions); dlg.appendChild(form); document.body.appendChild(dlg);
    const close = (r) => { dlg.close(); dlg.remove(); resolve(r); };
    cancel.addEventListener('click', () => close(false));
    dlg.addEventListener('cancel', () => close(false));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); msg.textContent = ''; [name, example, pax, bags, feats].forEach((f) => { f.err.textContent = ''; });
      const body = { name: name.i.value, example: example.i.value, passengers: pax.i.value, luggage: bags.i.value, features: feats.i.value.split('\n') };
      if (copy && copy.value) { body.copyFaresFrom = copy.value; body.farePercent = pct.value; }
      save.disabled = true;
      try {
        const res = existing ? await api('PATCH', `/api/admin/vehicles/${encodeURIComponent(existing.code)}`, body) : await api('POST', '/api/admin/vehicles', body);
        close(res);
      } catch (err) {
        const map = { name, example, passengers: pax, luggage: bags, features: feats };
        let shown = false;
        for (const [k, m] of Object.entries(err.fields || {})) if (map[k]) { map[k].err.textContent = m; shown = true; }
        if (!shown) msg.textContent = err.message;
        save.disabled = false;
      }
    });
    dlg.showModal(); name.i.focus();
  });
}

function card(v) {
  const c = el('article', `vcard card${v.active ? '' : ' is-hidden'}`);
  const frame = el('div', `vcard__img${v.image.photo ? ' is-photo' : ''}`);
  const img = el('img'); Object.assign(img, { src: `../public/${v.image.url}`, alt: `${v.name}${v.image.photo ? ' photo' : ' sample illustration'}`, width: 400, height: 300 });
  frame.appendChild(img);
  const info = el('div', 'vcard__info');
  info.append(el('h2', '', v.active ? v.name : `${v.name} (hidden)`), el('p', 'text-muted', `${v.example ? `${v.example}. ` : ''}Up to ${v.passengers} passengers and ${v.luggage} bags.`));
  const state = el('p', `vcard__state${v.image.photo ? ' vcard__state--on' : ''}`, v.image.photo ? 'Showing your photo on the website' : 'Showing a sample illustration');
  const actions = el('div', 'vcard__actions');
  const label = el('label', 'btn btn--primary btn--sm', v.image.photo ? 'Replace photo' : 'Upload photo');
  const input = el('input'); Object.assign(input, { type: 'file', accept: 'image/jpeg,image/png,image/webp' }); input.className = 'visually-hidden';
  label.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    label.setAttribute('aria-busy', 'true'); state.textContent = 'Uploading…';
    try {
      if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG, PNG or WebP).');
      const blob = await toJpeg(file);
      await apiUpload('PUT', `/api/admin/vehicles/${encodeURIComponent(v.code)}/image`, blob);
      toast(`${v.name} photo saved.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    await load();
  });
  actions.appendChild(label);
  if (v.image.photo) {
    const rm = el('button', 'btn btn--ghost btn--sm', 'Remove photo'); rm.type = 'button';
    rm.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Remove this photo?', message: `The website will go back to the sample illustration for ${v.name}.`, confirmLabel: 'Remove photo', danger: true }))) return;
      try { await api('DELETE', `/api/admin/vehicles/${encodeURIComponent(v.code)}/image`); toast('Photo removed.', 'success'); } catch (e) { toast(e.message, 'error'); }
      await load();
    });
    actions.appendChild(rm);
  }
  const web = el('form', 'vcard__web');
  const wl = el('label', 'visually-hidden', `Image web address for ${v.name}`); wl.htmlFor = `url-${v.code}`;
  const wi = el('input', 'input'); Object.assign(wi, { id: `url-${v.code}`, type: 'url', placeholder: 'Paste image link', autocomplete: 'off' });
  const wb = el('button', 'btn btn--ghost btn--sm', 'Use link'); wb.type = 'submit';
  web.append(wl, wi, wb);
  web.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!wi.value.trim()) { toast('Paste an image link first.', 'error'); return; }
    wb.disabled = true; state.textContent = 'Downloading…';
    try { await api('POST', `/api/admin/vehicles/${encodeURIComponent(v.code)}/image-from-url`, { url: wi.value.trim() }); toast(`${v.name} photo saved.`, 'success'); }
    catch (err) { toast(err.message, 'error'); }
    await load();
  });
  const manage = el('div', 'vcard__actions');
  const edit = el('button', 'btn btn--ghost btn--sm', 'Edit details'); edit.type = 'button';
  edit.addEventListener('click', async () => { if (await vehicleDialog(v)) { toast('Vehicle updated.', 'success'); await load(); } });
  const vis = el('button', 'btn btn--ghost btn--sm', v.active ? 'Hide' : 'Show'); vis.type = 'button';
  vis.addEventListener('click', async () => {
    try { await api('PATCH', `/api/admin/vehicles/${encodeURIComponent(v.code)}`, { active: !v.active }); toast(v.active ? 'Vehicle hidden.' : 'Vehicle is live.', 'success'); } catch (e) { toast(e.message, 'error'); }
    await load();
  });
  const del = el('button', 'btn btn--ghost btn--sm', 'Delete'); del.type = 'button';
  del.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: `Delete ${v.name}?`, message: 'This also removes its fares and photo. Vehicles used in past bookings cannot be deleted; hide them instead.', confirmLabel: 'Delete vehicle', danger: true }))) return;
    try { await api('DELETE', `/api/admin/vehicles/${encodeURIComponent(v.code)}`); toast('Vehicle deleted.', 'success'); } catch (e) { toast(e.message, 'error'); }
    await load();
  });
  manage.append(edit, vis, del);
  c.append(frame, info, state, actions, web, manage);
  return c;
}

async function load() {
  const grid = $('vehicle-grid');
  try {
    const { vehicles } = await api('GET', '/api/admin/vehicles');
    allVehicles = vehicles;
    grid.replaceChildren(...vehicles.map(card));
  } catch (e) { grid.replaceChildren(el('p', 'alert alert--error', e.message)); }
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  $('add-vehicle').addEventListener('click', async () => {
    const res = await vehicleDialog(null);
    if (res) { toast(res.faresCopied ? `Vehicle added with ${res.faresCopied} fares copied.` : 'Vehicle added. Add a photo and fares to start selling it.', 'success'); await load(); }
  });
  if (!(await requireAdmin())) return;
  load();
});
