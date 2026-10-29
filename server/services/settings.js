// Business settings live in the database (one JSON value per key) so the owner can change them later.
// Defaults here only apply to keys that have not been saved yet.
export const DEFAULT_SETTINGS = {
  business: { name: 'Sydney Airport Transfers', abn: '', phone: '', email: '', whatsapp: '', serviceArea: 'Sydney, NSW' },
  payments: { card_online: true, deposit: true, cash_to_driver: true },
  // Free until a leg is marked en_route; after that this percentage of the total fare is charged.
  cancellation: { fee_percent: 50 },
  // Share of the fare charged up front when a customer picks "deposit".
  deposit: { percent: 30 },
  booking: { min_lead_minutes: 180, max_advance_days: 365 },
};

export async function getSettings(db) {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const out = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) out[k] = { ...v };
  for (const r of rows) if (out[r.key] && typeof r.value === 'object') out[r.key] = { ...out[r.key], ...r.value };
  return out;
}

// ---- Saving (owner only) ----
import { ApiError, text, throwIfErrors, EMAIL_RE } from '../lib/validate.js';

const whole = (v, min, max) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return Number.isInteger(n) && n >= min && n <= max ? n : null; };

export function parseSettingsInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {}; const out = {};
  if (b.business !== undefined) {
    const x = b.business || {}; const biz = {};
    biz.name = text(x.name, { min: 2, max: 80 }); if (!biz.name) errors.name = 'Enter your business name';
    biz.abn = text(x.abn, { max: 20 }); if (biz.abn === null || (biz.abn && !/^[0-9 ]{11,14}$/.test(biz.abn))) errors.abn = 'An ABN is 11 digits';
    biz.phone = text(x.phone, { max: 30 }); if (biz.phone === null || (biz.phone && !/^[0-9+()\-\s]{6,30}$/.test(biz.phone))) errors.phone = 'Enter a valid phone number';
    biz.email = text(x.email, { max: 120 }); if (biz.email === null || (biz.email && !EMAIL_RE.test(biz.email))) errors.email = 'Enter a valid email';
    biz.whatsapp = text(x.whatsapp, { max: 20 }); if (biz.whatsapp === null || (biz.whatsapp && !/^[0-9]{8,15}$/.test(biz.whatsapp.replace(/\s/g, '')))) errors.whatsapp = 'Digits only, with country code, e.g. 61400000000';
    else if (biz.whatsapp) biz.whatsapp = biz.whatsapp.replace(/\s/g, '');
    biz.serviceArea = text(x.serviceArea, { min: 2, max: 80 }); if (!biz.serviceArea) errors.serviceArea = 'Enter your service area';
    out.business = biz;
  }
  if (b.payments !== undefined) {
    const x = b.payments || {};
    const pay = { card_online: x.card_online === true, deposit: x.deposit === true, cash_to_driver: x.cash_to_driver === true };
    if (!pay.card_online && !pay.deposit && !pay.cash_to_driver) errors.payments = 'Keep at least one payment option on';
    out.payments = pay;
  }
  if (b.deposit !== undefined) {
    const pct = whole((b.deposit || {}).percent, 5, 95);
    if (pct === null) errors.deposit_percent = 'Enter a whole number from 5 to 95';
    out.deposit = { percent: pct };
  }
  if (b.booking !== undefined) {
    const x = b.booking || {};
    const lead = whole(x.min_lead_minutes, 0, 60 * 24 * 14); const adv = whole(x.max_advance_days, 1, 730);
    if (lead === null) errors.min_lead_minutes = 'Enter minutes from 0 to 20,160'; if (adv === null) errors.max_advance_days = 'Enter days from 1 to 730';
    out.booking = { min_lead_minutes: lead, max_advance_days: adv };
  }
  throwIfErrors(errors);
  return out;
}

export async function saveSettings(db, input) {
  for (const [key, value] of Object.entries(input)) {
    await db.query(`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
  }
  return getSettings(db);
}
