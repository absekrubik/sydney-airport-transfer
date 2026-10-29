// Downloads an image from a web address an admin pasted. Because the address is typed by a person, it is treated as untrusted:
// https only, no private or internal network addresses (checked at connect time so DNS tricks cannot get around it),
// at most 3 redirects, a time limit and a size limit. The bytes are then checked as a real image by saveVehicleImage.
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import { ApiError } from './validate.js';
import { MAX_IMAGE_BYTES } from './images.js';

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

const bad = (message) => new ApiError(400, 'BAD_URL', message);

function getOnce(url, allowPrivate) {
  const lib = url.protocol === 'https:' ? https : http;
  const lookup = (host, opts, cb) => dns.lookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs.filter((a) => allowPrivate || !isPrivateAddress(a.address));
    if (!list.length) return cb(new Error('PRIVATE_ADDRESS'));
    if (opts.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { lookup, timeout: 10_000, headers: { 'User-Agent': 'SydneyAirportTransfers-admin/1.0', Accept: 'image/*' } }, resolve);
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
  });
}

export async function downloadImage(address, { allowPrivate = false } = {}) {
  let url;
  try { url = new URL(String(address || '').trim()); } catch { throw bad('That does not look like a web address. Paste the full image link, starting with https://'); }
  for (let hop = 0; hop < 4; hop += 1) {
    if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw bad('Only secure https:// image links can be used.');
    if (url.username || url.password) throw bad('Links with a username or password are not allowed.');
    let res;
    try { res = await getOnce(url, allowPrivate); } catch (e) {
      if (e.message === 'PRIVATE_ADDRESS') throw bad('That address points to a private network and cannot be used.');
      throw bad('Could not download that link. Check the address and try again.');
    }
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      try { url = new URL(res.headers.location, url); } catch { throw bad('That link redirects somewhere invalid.'); }
      continue;
    }
    if (res.statusCode !== 200) { res.resume(); throw bad(`The website answered with an error (${res.statusCode}). Try a different image link.`); }
    const declared = Number(res.headers['content-length'] || 0);
    if (declared > MAX_IMAGE_BYTES) { res.resume(); throw new ApiError(413, 'TOO_LARGE', 'That image is larger than 3 MB. Choose a smaller one.'); }
    const chunks = []; let size = 0;
    for await (const chunk of res) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) { res.destroy(); throw new ApiError(413, 'TOO_LARGE', 'That image is larger than 3 MB. Choose a smaller one.'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw bad('That link redirects too many times.');
}
