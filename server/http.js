// A small HTTP toolkit on Node's built-in http module: router, JSON body, cookies, static files,
// security headers and rate limiting. No framework needed for this API.
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './lib/validate.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

// Allowed outside sources: Google Fonts, the Leaflet library, OpenStreetMap tiles and the address lookup.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://cdnjs.cloudflare.com",
  "connect-src 'self' https://nominatim.openstreetmap.org",
  "media-src 'self'",
  "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');

export function securityHeaders(res, { production }) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore a bad cookie */ } }
  }
  return out;
}

export function cookieHeader(name, value, { maxAgeSeconds, secure }) {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', secure ? 'Secure' : '', maxAgeSeconds !== undefined ? `Max-Age=${maxAgeSeconds}` : ''].filter(Boolean).join('; ');
}

export async function readJson(req, limit = 64 * 1024) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'TOO_LARGE', 'That request is too large.');
    chunks.push(chunk);
  }
  if (!size) return {};
  if (type !== 'application/json') throw new ApiError(415, 'BAD_REQUEST', 'Send JSON with Content-Type: application/json.');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'BAD_REQUEST', 'That request was not valid JSON.'); }
}

/** Reads a binary body (an uploaded image) up to a size limit. */
export async function readRaw(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ApiError(413, 'TOO_LARGE', 'That file is too large. Use a photo under 3 MB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** In-memory sliding-window limiter. Fine for one server process; use a shared store if you scale out. */
export function createRateLimiter() {
  const hits = new Map();
  return {
    check(key, max, windowMs, now = Date.now()) {
      const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(now); hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return true;
    },
  };
}

export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      const keys = [];
      const re = new RegExp(`^${pattern.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
      routes.push({ method, re, keys, handler });
    },
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method === method) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return { methodNotAllowed: pathMatched };
    },
  };
}

/** Serves files from the given folders only (e.g. /public and /admin). Nothing else on disk is reachable. */
export function createStatic(root, folders) {
  const resolved = new Map(folders.map((f) => [f, path.join(root, f)]));
  return function serve(req, res, pathname) {
    if (pathname === '/') { res.writeHead(302, { Location: '/public/index.html' }); res.end(); return true; }
    const folder = folders.find((f) => pathname === `/${f}` || pathname.startsWith(`/${f}/`));
    if (!folder) return false;
    let rel; try { rel = decodeURIComponent(pathname.slice(folder.length + 1)); } catch { return false; }
    if (rel.includes('\0') || rel.split('/').some((seg) => seg.startsWith('.'))) return false; // no dotfiles, no traversal
    const base = resolved.get(folder);
    let file = path.join(base, rel);
    if (!file.startsWith(base + path.sep) && file !== base) return false;
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { return false; }
    let stat; try { stat = fs.statSync(file); } catch { return false; }
    if (!stat.isFile()) return false;
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', ETag: etag, 'Cache-Control': 'no-cache', 'Content-Length': stat.size };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return true; }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(file).pipe(res);
    return true;
  };
}
