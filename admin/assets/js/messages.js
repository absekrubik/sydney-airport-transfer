// Admin > Messages: what customers sent through the website contact form.
import { initAdminShell, requireAdmin } from './admin-shell.js';
import { api } from '../../../public/assets/js/api.js';
import { toast } from '../../../public/assets/js/ui/ui.js';
import { sydneyTime } from './admin-util.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

async function load() {
  const list = $('msg-list');
  try {
    const { messages, open } = await api('GET', `/api/admin/messages?handled=${$('m-filter').value}`);
    $('m-open').textContent = open ? `${open} waiting for a reply` : 'All caught up';
    list.replaceChildren();
    if (!messages.length) list.appendChild(el('p', 'text-muted', 'No messages here.'));
    messages.forEach((m) => {
      const card = el('article', `card msg${m.is_handled ? ' is-done' : ''}`);
      const head = el('div', 'row'); head.append(el('strong', '', m.name), el('span', 'badge', m.topic), el('span', 'text-muted', sydneyTime(m.created_at)));
      const contact = el('p', 'text-muted'); const a = el('a', '', m.email); a.href = `mailto:${m.email}`; contact.append(a); if (m.phone) contact.append(` · ${m.phone}`);
      const msg = el('p', 'msg__text', m.message);
      card.append(head, contact, msg);
      if (m.trip_details && typeof m.trip_details === 'object') {
        const d = el('dl', 'review'); Object.entries(m.trip_details).sort(([a], [b]) => (a === 'from' ? -1 : b === 'from' ? 1 : 0)).forEach(([k, v]) => { if (v) d.append(el('dt', '', k.replace(/([A-Z])/g, ' $1').toLowerCase()), el('dd', '', String(v))); }); card.appendChild(d);
      }
      const btn = el('button', 'btn btn--ghost btn--sm', m.is_handled ? 'Mark as not handled' : 'Mark as handled'); btn.type = 'button';
      btn.addEventListener('click', async () => { try { await api('PATCH', `/api/admin/messages/${m.id}`, { handled: !m.is_handled }); } catch (e) { toast(e.message, 'error'); } load(); });
      card.appendChild(btn); list.appendChild(card);
    });
  } catch (e) { list.replaceChildren(el('p', 'alert alert--error', e.message)); }
}

window.addEventListener('DOMContentLoaded', async () => {
  initAdminShell();
  if (!(await requireAdmin())) return;
  $('m-filter').addEventListener('change', load);
  load();
});
