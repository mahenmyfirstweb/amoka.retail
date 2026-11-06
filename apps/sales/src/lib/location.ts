/**
 * Location sharing for the admin Live Map.
 * While the app is open: a position every 2 minutes (or after moving ~150 m), plus one with each
 * order / invoice / receipt / diesel top-up. Only when the company setting "track_location" is on
 * and the salesman allowed location in the browser.
 */
import { supabase } from './supabase';

const PING_MS = 2 * 60 * 1000;
let watchId: number | null = null;
let last: { lat: number; lng: number; t: number } | null = null;
let current: GeolocationPosition | null = null;
let userId: string | null = null;

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

async function send(pos: GeolocationPosition, event: string) {
  if (!userId || !navigator.onLine) return;
  const c = pos.coords;
  last = { lat: c.latitude, lng: c.longitude, t: Date.now() };
  await supabase.from('device_locations').insert({
    lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading, event,
  });
}

export const locationSupported = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;
export const isTracking = () => watchId !== null;

export function startTracking(uid: string) {
  if (!locationSupported() || watchId !== null) return;
  userId = uid;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      current = pos;
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!last || Date.now() - last.t >= PING_MS || metres(last, here) > 150) send(pos, 'PING').catch(() => {});
    },
    () => { /* permission denied / unavailable: silently skip */ },
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
  );
  // Keep pinging every 2 minutes even when standing still.
  const timer = setInterval(() => {
    if (watchId === null) return clearInterval(timer);
    if (current && (!last || Date.now() - last.t >= PING_MS)) send(current, 'PING').catch(() => {});
  }, PING_MS);
}

export function stopTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  userId = null;
}

/** Records the position with a business event (ORDER, INVOICE, RECEIPT, FUEL, RETURN). */
export function logEvent(event: string) {
  if (!userId) return;
  if (current && Date.now() - current.timestamp < 5 * 60 * 1000) {
    send(current, event).catch(() => {});
    return;
  }
  navigator.geolocation?.getCurrentPosition((p) => send(p, event).catch(() => {}), () => {}, { maximumAge: 60_000, timeout: 15_000 });
}
