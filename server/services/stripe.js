// Minimal Stripe client using the REST API directly (no SDK, so no extra dependency).
// Tests inject a fake with the same methods.
import crypto from 'node:crypto';
import { ApiError } from '../lib/validate.js';

/** Stripe wants form encoding with bracketed keys: a[b][0]=c */
export function encodeForm(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (item && typeof item === 'object' ? encodeForm(item, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`)));
    else if (typeof v === 'object') encodeForm(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out;
}

export function createStripe({ secretKey, fetchImpl = fetch, baseUrl = 'https://api.stripe.com', log = console }) {
  if (!secretKey) return null;
  async function call(method, path, params, idempotencyKey) {
    const headers = { Authorization: `Bearer ${secretKey}` };
    let body;
    if (method !== 'GET' && params) { body = encodeForm(params).join('&'); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let res;
    try { res = await fetchImpl(baseUrl + path, { method, headers, body, signal: AbortSignal.timeout(20_000) }); }
    catch (e) { log.error('Stripe request failed:', e.message); throw new ApiError(502, 'PAYMENT_PROVIDER', 'We could not reach the payment provider. Please try again in a moment.'); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      log.error(`Stripe error ${res.status} on ${method} ${path}:`, json?.error?.message || '');
      throw new ApiError(502, 'PAYMENT_PROVIDER', 'The payment provider refused that request. Please try again, or contact us.');
    }
    return json;
  }
  return {
    mode: secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_') ? 'live' : 'test',
    createCheckoutSession: (params, key) => call('POST', '/v1/checkout/sessions', params, key),
    retrieveSession: (id) => call('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`),
    expireSession: (id) => call('POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {}),
    createRefund: (params, key) => call('POST', '/v1/refunds', params, key),
  };
}

/** Check the Stripe-Signature header: t=timestamp,v1=hmac(timestamp.body). Rejects old or forged requests. */
export function verifyStripeSignature(rawBody, header, secret, nowMs = Date.now(), toleranceSeconds = 300) {
  if (!secret || !header) return false;
  const parts = String(header).split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  const eb = Buffer.from(expected);
  return sigs.some((s) => { const sb = Buffer.from(s); return sb.length === eb.length && crypto.timingSafeEqual(sb, eb); });
}
