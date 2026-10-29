import { formatMoney, icon, setVehicleImage } from '../ui/ui.js';
import { api } from '../api.js';
import { initCommon } from '../common.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function render() {
  const host = document.getElementById('fleet-list');
  let vehicles; let routes;
  try {
    [{ vehicles }, routes] = await Promise.all([api('GET', '/api/vehicle-categories'), api('GET', '/api/routes')]);
  } catch (e) { host.appendChild(el('p', 'text-muted', e.message)); return; }
  if (vehicles.every((v) => v.image?.photo)) document.getElementById('sample-note')?.remove();
  const first = routes.routes.find((r) => /International/.test(r.from) && /CBD/.test(r.to)) || routes.routes[0];
  vehicles.forEach((v) => {
    const row = el('article', 'fleet-row');
    const art = el('div', 'fleet-row__img');
    const img = el('img');
    Object.assign(img, { alt: v.name, loading: 'lazy', width: 400, height: 300 });
      setVehicleImage(img, v);
    art.appendChild(img);
    const text = el('div');
    const specs = el('ul', 'specs');
    [['users', `${v.passengers} passengers`], ['briefcase', `${v.luggage} bags`]].forEach(([i, t]) => { const li = el('li'); li.append(icon(i), t); specs.appendChild(li); });
    const features = el('ul', 'features');
    (v.features || []).forEach((f) => { const li = el('li'); li.append(icon('check'), f); features.appendChild(li); });
    const book = el('a', 'btn btn--primary', 'Book this vehicle');
    book.href = `booking.html?vehicle=${encodeURIComponent(v.code)}`;
    text.append(el('h2', '', v.name), el('p', 'example', v.example || ''), specs, features);
    const cents = first?.fares?.[v.code];
    if (cents) {
      const fareLine = el('p', 'fare-line');
      fareLine.append(`${first.from.split(' (')[0]} to ${first.to} from `, el('strong', '', formatMoney(cents)), routes.sample ? ' (sample fare, GST included)' : ' (GST included)');
      text.appendChild(fareLine);
    }
    text.appendChild(book);
    row.append(art, text);
    host.appendChild(row);
  });
}

window.addEventListener('DOMContentLoaded', async () => { await render(); initCommon('.fleet-row'); });
