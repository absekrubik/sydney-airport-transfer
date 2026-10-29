import { hashPassword, verifyPassword, randomToken, sha256 } from '../lib/crypto.js';
import { ApiError, EMAIL_RE } from '../lib/validate.js';

export const SESSION_ABSOLUTE_MS = 12 * 3600 * 1000;  // log in again after 12 hours
export const SESSION_IDLE_MS = 2 * 3600 * 1000;       // or after 2 hours of no activity
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const MIN_PASSWORD = 12;

// Used when the email is unknown so the response takes the same time as a real check.
let dummyHash;

export function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters (a few random words works well).`;
  if (password.length > 200) return 'That password is too long.';
  return '';
}

export async function createUser(db, { email, fullName, role, password }) {
  if (!EMAIL_RE.test(email || '')) throw new ApiError(400, 'VALIDATION', 'Enter a valid email address.');
  if (!['owner', 'staff'].includes(role)) throw new ApiError(400, 'VALIDATION', 'Role must be owner or staff.');
  const weak = checkPasswordStrength(password); if (weak) throw new ApiError(400, 'VALIDATION', weak);
  const hash = await hashPassword(password);
  const { rows } = await db.query('INSERT INTO users (email, password_hash, role, full_name) VALUES ($1,$2,$3,$4) RETURNING id, email, role, full_name', [email.trim(), hash, role, fullName]);
  return rows[0];
}

export async function login(db, { email, password, ip = '', userAgent = '' }, now = new Date()) {
  const generic = new ApiError(401, 'BAD_LOGIN', 'Incorrect email or password.');
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || password.length > 200) throw generic;
  const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
  const user = rows[0];
  dummyHash ??= await hashPassword('not-a-real-password');
  const ok = await verifyPassword(password, user ? user.password_hash : dummyHash);

  if (user?.locked_until && new Date(user.locked_until) > now) throw new ApiError(429, 'LOCKED', 'Too many failed attempts. Please try again in a few minutes.');
  if (!user || !ok || !user.is_active) {
    if (user) {
      const failures = user.failed_login_count + 1;
      if (failures >= MAX_FAILURES) await db.query('UPDATE users SET failed_login_count = 0, locked_until = $2 WHERE id = $1', [user.id, new Date(now.getTime() + LOCK_MS).toISOString()]);
      else await db.query('UPDATE users SET failed_login_count = $2 WHERE id = $1', [user.id, failures]);
    }
    throw generic;
  }

  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = $2 WHERE id = $1', [user.id, now.toISOString()]);
  const token = randomToken(); const csrf = randomToken(24);
  await db.query('INSERT INTO sessions (user_id, token_hash, csrf_token, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [user.id, sha256(token), csrf, ip, userAgent.slice(0, 200), new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString()]);
  return { token, csrf, maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000, user: publicUser(user) };
}

export const publicUser = (u) => ({ id: u.id, email: u.email, role: u.role, fullName: u.full_name });

export async function getSession(db, token, now = new Date()) {
  if (!token) return null;
  const idleCutoff = new Date(now.getTime() - SESSION_IDLE_MS).toISOString();
  const { rows } = await db.query(
    `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND s.last_seen_at > $3 AND u.is_active`, [sha256(token), now.toISOString(), idleCutoff]);
  if (!rows.length) return null;
  const r = rows[0];
  if (now - new Date(r.last_seen_at) > 60000) await db.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [r.session_id, now.toISOString()]);
  return { sessionId: r.session_id, csrf: r.csrf_token, user: publicUser(r) };
}

export async function logout(db, token) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export async function changePassword(db, session, currentPassword, newPassword) {
  const weak = checkPasswordStrength(newPassword); if (weak) throw new ApiError(400, 'VALIDATION', weak, { newPassword: weak });
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [session.user.id]);
  if (!rows.length || !(await verifyPassword(String(currentPassword || ''), rows[0].password_hash))) throw new ApiError(400, 'VALIDATION', 'Your current password is not correct.', { currentPassword: 'Not correct' });
  if (newPassword === currentPassword) throw new ApiError(400, 'VALIDATION', 'Choose a different password.', { newPassword: 'Choose a different password' });
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [session.user.id, await hashPassword(newPassword)]);
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [session.user.id, session.sessionId]); // sign out everywhere else
}
