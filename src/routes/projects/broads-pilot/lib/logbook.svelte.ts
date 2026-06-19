// Cruise logbook: records the GPS track while you're in live cruise mode and
// keeps a journal of past cruises. Tracks can be hundreds of points, so they
// live in IndexedDB (not localStorage). The recording lifecycle is driven from
// the page's geolocation watch: start() when cruise begins, addPoint() on each
// fix, stop() when cruise ends (which finalises stats and persists, discarding
// trivial/stationary "cruises"). All IndexedDB access is browser-only and
// fail-soft — a missing/blocked IDB never throws into the UI.
import { haversine } from './geo';
import type { Boat } from './types';

export interface TrackPoint { lat: number; lng: number; t: number; speed: number | null }
export interface CruiseLog {
  id: string;
  startedAt: number;
  endedAt: number | null;
  boatSlug: string | null;
  boatName: string | null;
  title: string;
  notes: string;
  points: TrackPoint[];
  distance_m: number;
  maxSpeedMph: number;
  movingTime_s: number;
}

const DB_NAME = 'broads-pilot-log';
const STORE = 'cruises';
const MOVING_MPS = 0.58; // ~1.3 mph — under way, not GPS jitter
const MIN_DISTANCE_M = 60; // discard cruises shorter than this on stop()
const MIN_POINTS = 4;

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbAll(): Promise<CruiseLog[]> {
  if (!hasIDB()) return [];
  try {
    const db = await openDB();
    return await new Promise<CruiseLog[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as CruiseLog[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

async function idbPut(log: CruiseLog): Promise<void> {
  if (!hasIDB()) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put($state.snapshot(log) as CruiseLog);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* fail soft */ }
}

async function idbDelete(id: string): Promise<void> {
  if (!hasIDB()) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* fail soft */ }
}

let counter = 0;
function newId(startedAt: number): string {
  return `cl-${startedAt.toString(36)}-${(counter++).toString(36)}`;
}

export class Logbook {
  entries = $state<CruiseLog[]>([]);
  recording = $state(false);
  // live stats for the in-progress cruise (surfaced in the cruise banner)
  liveDistance_m = $state(0);
  liveMaxMph = $state(0);
  loaded = $state(false);

  // the in-progress log is plain (not reactive) — points can be hundreds long
  private current: CruiseLog | null = null;
  private lastPoint: TrackPoint | null = null;

  async load() {
    const all = await idbAll();
    all.sort((a, b) => b.startedAt - a.startedAt);
    this.entries = all;
    this.loaded = true;
  }

  start(boat: Boat | null) {
    const startedAt = Date.now();
    this.current = {
      id: newId(startedAt), startedAt, endedAt: null,
      boatSlug: boat?.slug ?? null, boatName: boat?.name ?? null,
      title: '', notes: '', points: [], distance_m: 0, maxSpeedMph: 0, movingTime_s: 0,
    };
    this.lastPoint = null;
    this.liveDistance_m = 0;
    this.liveMaxMph = 0;
    this.recording = true;
  }

  /** Add a fix. `speed` is metres/second (may be null). */
  addPoint(lat: number, lng: number, speed: number | null) {
    const c = this.current;
    if (!c) return;
    const t = Date.now();
    const pt: TrackPoint = { lat, lng, t, speed: speed ?? null };
    const prev = this.lastPoint;
    if (prev) {
      const d = haversine([prev.lat, prev.lng], [lat, lng]);
      const dt = (t - prev.t) / 1000;
      // ignore obvious GPS teleports (>40 m/s) and sub-2 m jitter
      if (d >= 2 && d / Math.max(dt, 0.1) < 40) {
        c.distance_m += d;
        if (dt > 0 && (speed ?? d / dt) >= MOVING_MPS) c.movingTime_s += dt;
      }
    }
    const mph = (speed ?? 0) * 2.236936;
    if (mph > c.maxSpeedMph) c.maxSpeedMph = mph;
    c.points.push(pt);
    this.lastPoint = pt;
    this.liveDistance_m = c.distance_m;
    this.liveMaxMph = c.maxSpeedMph;
  }

  /** Finalise + persist the current cruise. Returns the saved log, or null if
   *  it was too short/stationary to be worth keeping. */
  async stop(): Promise<CruiseLog | null> {
    const c = this.current;
    this.current = null;
    this.lastPoint = null;
    this.recording = false;
    if (!c) return null;
    c.endedAt = Date.now();
    c.maxSpeedMph = +c.maxSpeedMph.toFixed(1);
    c.distance_m = Math.round(c.distance_m);
    c.movingTime_s = Math.round(c.movingTime_s);
    if (c.distance_m < MIN_DISTANCE_M || c.points.length < MIN_POINTS) return null;
    c.title = c.title || defaultTitle(c.startedAt);
    await idbPut(c);
    this.entries = [c, ...this.entries];
    return c;
  }

  async update(id: string, patch: Partial<Pick<CruiseLog, 'title' | 'notes'>>) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    if (patch.title != null) e.title = patch.title;
    if (patch.notes != null) e.notes = patch.notes;
    await idbPut(e);
  }

  async remove(id: string) {
    this.entries = this.entries.filter((x) => x.id !== id);
    await idbDelete(id);
  }
}

export function defaultTitle(startedAt: number): string {
  const d = new Date(startedAt);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' cruise';
}

/** Serialise a cruise track to GPX 1.1 for export to other tools. */
export function toGpx(log: CruiseLog): string {
  const pts = log.points.map((p) =>
    `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`,
  ).join('\n');
  const title = (log.title || defaultTitle(log.startedAt)).replace(/[<&>]/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Broads Pilot" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${title}</name><trkseg>
${pts}
  </trkseg></trk>
</gpx>`;
}

export const logbook = new Logbook();
