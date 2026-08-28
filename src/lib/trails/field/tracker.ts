// GPS recording. Ported from JKAImaps.
//
// The filtering rules are the interesting part and are pure, so they are
// exported separately from the watch itself and tested without a browser.

export type FilterResult = 'accept' | 'flag' | 'reject';

/** Beyond this the fix is a guess from cell towers, not GPS. */
const REJECT_ACCURACY_M = 100;
/** Usable, but worth showing as uncertain. */
const FLAG_ACCURACY_M = 30;
/** A point every 3 s is plenty; 1 Hz just burns battery and storage. */
const MIN_INTERVAL_MS = 3000;
/** No one runs at 45 km/h. A jump this fast is a fix error, not movement. */
const MAX_PLAUSIBLE_SPEED_MS = 12.5;

export interface Fix {
  lat: number;
  lng: number;
  elevation: number | null;
  timestamp: number; // epoch ms
  accuracy: number;
}

export function classifyFix(fix: Fix): FilterResult {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return 'reject';
  if (fix.accuracy > REJECT_ACCURACY_M) return 'reject';
  if (fix.accuracy > FLAG_ACCURACY_M) return 'flag';
  return 'accept';
}

export function shouldRecord(now: number, lastRecordedAt: number): boolean {
  return now - lastRecordedAt >= MIN_INTERVAL_MS;
}

/**
 * Reject a fix that implies impossible speed since the last accepted one.
 *
 * Without this a single bad fix adds a spike out and back — inflating distance
 * by hundreds of metres and, worse, reading as an out-and-back spur later.
 */
export function isPlausibleStep(
  from: { lat: number; lng: number; timestamp: number },
  to: { lat: number; lng: number; timestamp: number },
): boolean {
  const dtS = (to.timestamp - from.timestamp) / 1000;
  if (dtS <= 0) return false;
  const R = 6371008.8;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const latRad = (((from.lat + to.lat) / 2) * Math.PI) / 180;
  const x = dLng * Math.cos(latRad);
  const distanceM = Math.sqrt(x * x + dLat * dLat) * R;
  return distanceM / dtS <= MAX_PLAUSIBLE_SPEED_MS;
}

export interface TrackerCallbacks {
  onFix: (fix: Fix, verdict: FilterResult) => void;
  onError?: (error: GeolocationPositionError) => void;
}

export interface TrackerHandle {
  stop: () => void;
}

export function startTracking(callbacks: TrackerCallbacks): TrackerHandle {
  let lastRecordedAt = 0;
  let lastAccepted: Fix | null = null;

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      const fix: Fix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        elevation: position.coords.altitude,
        timestamp: position.timestamp,
        accuracy: position.coords.accuracy,
      };

      const verdict = classifyFix(fix);
      if (verdict === 'reject') {
        callbacks.onFix(fix, 'reject');
        return;
      }
      if (!shouldRecord(fix.timestamp, lastRecordedAt)) return;
      if (lastAccepted && !isPlausibleStep(lastAccepted, fix)) {
        callbacks.onFix(fix, 'reject');
        return;
      }

      lastRecordedAt = fix.timestamp;
      lastAccepted = fix;
      callbacks.onFix(fix, verdict);
    },
    (error) => callbacks.onError?.(error),
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20_000 },
  );

  return {
    stop: () => navigator.geolocation.clearWatch(watchId),
  };
}

/** Keep the screen awake while recording. Silently absent on unsupported browsers. */
export async function requestWakeLock(): Promise<{ release: () => void } | null> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (!nav.wakeLock) return null;
    const sentinel = await nav.wakeLock.request('screen');
    return { release: () => void sentinel.release().catch(() => {}) };
  } catch {
    return null;
  }
}
