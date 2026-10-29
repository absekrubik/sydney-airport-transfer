// All stored times are UTC. Customers type local Sydney time; these helpers convert safely
// across daylight saving (no manual +10/+11 offsets).
export const TIME_ZONE = 'Australia/Sydney';

const partsFmt = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function sydneyParts(date) {
  const o = {};
  for (const p of partsFmt.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

/** Offset (ms) of Sydney from UTC at a given instant. */
function offsetMs(date) {
  const p = sydneyParts(date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** '2030-01-10' + '10:00' (Sydney wall-clock) -> Date (the real UTC instant). Returns null if invalid. */
export function sydneyToUtc(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr || '');
  if (!d || !t) return null;
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const asUtc = Date.UTC(y, mo - 1, da, Number(t[1]), Number(t[2]));
  const probe = new Date(asUtc);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return null; // e.g. 31 Feb
  // Two passes handle the hour either side of a daylight-saving change.
  let guess = asUtc - offsetMs(new Date(asUtc));
  guess = asUtc - offsetMs(new Date(guess));
  return new Date(guess);
}

/** Date -> 'Thu 10 Jan 2030, 10:00 am' in Sydney time, for emails and the confirmation page. */
export function formatSydney(date) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}
