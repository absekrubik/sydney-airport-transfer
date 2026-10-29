// The browser's only way to talk to the server. Every call returns parsed JSON or throws ApiError.
export class ApiError extends Error {
  constructor(status, code, message, fields) { super(message); this.status = status; this.code = code; this.fields = fields || {}; }
}

let csrfToken = '';
export const setCsrf = (t) => { csrfToken = t || ''; };

export async function api(method, path, body, { signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, signal, credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'We cannot reach the booking system right now. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or not JSON */ }
  if (!res.ok) {
    const err = data?.error || {};
    throw new ApiError(res.status, err.code || 'ERROR', err.message || 'Something went wrong. Please try again.', err.fields);
  }
  return data;
}

/** Trip fields from a form (see trip-controls.readTrip) in the shape the API expects. */
export function tripBody(trip) {
  const place = (label, lat, lng) => (typeof lat === 'number' && typeof lng === 'number' ? { label, lat, lng } : { label });
  return {
    pickup: place(trip.pickup, trip.pickupLat, trip.pickupLng),
    destination: place(trip.destination, trip.destinationLat, trip.destinationLng),
    tripType: trip.tripType, date: trip.date, time: trip.time, returnDate: trip.returnDate, returnTime: trip.returnTime,
    passengers: trip.passengers, luggage: trip.luggage, childSeats: trip.childSeats,
  };
}

/** Sends a file (Blob) as the request body. Used by the admin portal for photo uploads. */
export async function apiUpload(method, path, blob) {
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-CSRF-Token': csrfToken }, body: blob });
  } catch { throw new ApiError(0, 'NETWORK', 'We cannot reach the server right now. Check your connection and try again.'); }
  let data = null; try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) { const err = data?.error || {}; throw new ApiError(res.status, err.code || 'ERROR', err.message || 'Upload failed. Please try again.', err.fields); }
  return data;
}
