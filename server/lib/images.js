// Vehicle photos are optional. An admin uploads them in the admin portal (or you can copy files into
// public/assets/images/vehicles/ named after the category code, e.g. sedan.jpg). Without a photo the site shows
// the built-in illustration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './validate.js';

export const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'assets', 'images', 'vehicles');
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const EXTENSIONS = ['jpg', 'jpeg', 'webp', 'png'];
const safeCode = (code) => String(code).replace(/[^a-z0-9_-]/gi, '');

/** Looks at the first bytes of the file, not the name or the browser's claim, to decide what it really is. */
export function detectImageType(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export function vehicleImage(code, dir = DEFAULT_DIR) {
  const safe = safeCode(code);
  for (const ext of EXTENSIONS) {
    try {
      const stat = fs.statSync(path.join(dir, `${safe}.${ext}`));
      return { url: `assets/images/vehicles/${safe}.${ext}?v=${Math.floor(stat.mtimeMs)}`, photo: true };
    } catch { /* no file with this extension */ }
  }
  // New vehicle types added in the admin have no drawing yet, so they use a plain car until a photo is added
  const drawn = ['sedan', 'suv', 'van', 'luxury'].includes(safe) ? safe : 'generic';
  return { url: `assets/images/vehicles/${drawn}.svg`, photo: false };
}

export function saveVehicleImage(code, buf, dir = DEFAULT_DIR) {
  const safe = safeCode(code);
  if (!buf || !buf.length) throw new ApiError(400, 'BAD_IMAGE', 'No image was received.');
  if (buf.length > MAX_IMAGE_BYTES) throw new ApiError(413, 'TOO_LARGE', 'That image is too large. Use a photo under 3 MB.');
  const type = detectImageType(buf);
  if (!type) throw new ApiError(415, 'BAD_IMAGE', 'Please upload a JPG, PNG or WebP photo.');
  fs.mkdirSync(dir, { recursive: true });
  for (const ext of EXTENSIONS) if (ext !== type) fs.rmSync(path.join(dir, `${safe}.${ext}`), { force: true });
  fs.writeFileSync(path.join(dir, `${safe}.${type}`), buf);
  return vehicleImage(safe, dir);
}

export function removeVehicleImage(code, dir = DEFAULT_DIR) {
  const safe = safeCode(code);
  for (const ext of EXTENSIONS) fs.rmSync(path.join(dir, `${safe}.${ext}`), { force: true });
  return vehicleImage(safe, dir);
}
