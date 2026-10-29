// Reads settings from environment variables (and an optional .env file). No secrets live in code.
import crypto from 'node:crypto';

export function loadEnvFile(path = '.env') {
  try { process.loadEnvFile(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const warnings = [];
  let secret = env.APP_SECRET;
  if (!secret || secret.length < 32) {
    if (production) throw new Error('APP_SECRET must be set to a random string of at least 32 characters in production.');
    secret = crypto.randomBytes(32).toString('hex');
    warnings.push('APP_SECRET is not set: using a temporary secret. Fare quotes made before a restart will expire.');
  }
  if (production && env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) warnings.push('STRIPE_WEBHOOK_SECRET is not set: card payments will not be marked as paid automatically.');
  if (production && !env.PUBLIC_URL) warnings.push('PUBLIC_URL is not set: Stripe will send customers back to localhost.');
  return {
    production,
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL || '',
    secret,
    // Only mark cookies Secure when served over HTTPS (production). Local http://localhost needs them without it.
    cookieSecure: production,
    trustProxy: env.TRUST_PROXY === '1',
    // Payments (Stripe). Without a secret key the site still works: card options are simply hidden.
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    // Driving distances for fares off the fixed routes (OpenRouteService). Blank = those trips need a manual quote.
    orsApiKey: env.ORS_API_KEY || '',
    // Where Stripe sends customers back to. Must be the public address of this site.
    publicUrl: (env.PUBLIC_URL || `http://localhost:${Number(env.PORT || 3000)}`).replace(/\/+$/, ''),
    rateLimitScale: 1, // tests raise this; real deployments keep 1
    warnings,
  };
}
