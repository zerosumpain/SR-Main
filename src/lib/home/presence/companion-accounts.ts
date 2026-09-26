// src/lib/home/presence/companion-accounts.ts
//
// Accounts on the iPhone companion pilot, managed from the site: the calls
// /welcome makes to set a person up (create them in the owner's family, mint a
// pairing code, turn location sharing on or off) and the calls
// /admin/access/devices makes to list and revoke paired phones.
//
// Same lane and token as the household trail (`./companion`): Bearer
// COMPANION_HOUSEHOLD_TOKEN against COMPANION_URL (default loopback :5295).
// The pilot operates only within the owner's family, so this client cannot
// reach anybody the household lane could not already see.
//
// Nothing here throws. Every call answers a `PilotResult`, so a page can say
// "the app server is unreachable" beside the parts of it that still work,
// rather than failing whole. Unset token = `unconfigured`, and no request is
// made — the state of every host that is not production.
//
// Spec: docs/superpowers/specs/2026-09-26-apple-app-breakout.md (Contract A)

import { companionToken, companionUrl } from './companion';

const TIMEOUT_MS = 8_000;

export type PilotFailure = 'unconfigured' | 'unreachable' | 'refused' | 'not-found' | 'conflict' | 'bad-response';

export type PilotResult<T> = { ok: true; value: T } | { ok: false; reason: PilotFailure; status?: number };

export interface PilotUser {
  id: string | number;
  email: string;
  name: string;
  created: boolean;
}

export interface PilotPairCode {
  code: string;
  /** The exact JSON string the QR encodes. */
  payload: string;
  /** Seconds. */
  expiresIn: number;
}

export interface PilotDevice {
  id: string;
  email: string;
  name: string | null;
  label: string | null;
  created: string | null;
  expires: string | null;
  lastUsed: string | null;
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<PilotResult<unknown>> {
  const token = companionToken();
  if (!token) return { ok: false, reason: 'unconfigured' };
  let res: Response;
  try {
    res = await fetchImpl(`${companionUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (res.status === 204) return { ok: true, value: null };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'refused', status: res.status };
  if (res.status === 404) return { ok: false, reason: 'not-found', status: 404 };
  if (res.status === 409) return { ok: false, reason: 'conflict', status: 409 };
  if (!res.ok) return { ok: false, reason: 'unreachable', status: res.status };
  try {
    return { ok: true, value: await res.json() };
  } catch {
    return { ok: false, reason: 'bad-response', status: res.status };
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Create (or find) a person in the owner's family. 409 = they belong to another family. */
export async function upsertPilotUser(
  email: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PilotResult<PilotUser>> {
  const r = await call('POST', '/api/apple/household/users', { email: email.trim().toLowerCase(), name }, fetchImpl);
  if (!r.ok) return r;
  const b = (r.value ?? {}) as Record<string, unknown>;
  if (typeof b.email !== 'string') return { ok: false, reason: 'bad-response' };
  return {
    ok: true,
    value: {
      id: typeof b.id === 'number' || typeof b.id === 'string' ? b.id : '',
      email: b.email,
      name: str(b.name) ?? name,
      created: b.created === true,
    },
  };
}

/** A fresh ten-minute pairing code for a person in the family; the old one stops working. */
export async function pilotPairCode(email: string, fetchImpl: typeof fetch = fetch): Promise<PilotResult<PilotPairCode>> {
  const r = await call('POST', '/api/apple/household/pair-code', { email: email.trim().toLowerCase() }, fetchImpl);
  if (!r.ok) return r;
  const b = (r.value ?? {}) as Record<string, unknown>;
  if (typeof b.code !== 'string' || typeof b.payload !== 'string') return { ok: false, reason: 'bad-response' };
  return {
    ok: true,
    value: { code: b.code, payload: b.payload, expiresIn: typeof b.expiresIn === 'number' ? b.expiresIn : 600 },
  };
}

/** Every live companion device in the family. */
export async function listPilotDevices(fetchImpl: typeof fetch = fetch): Promise<PilotResult<PilotDevice[]>> {
  const r = await call('GET', '/api/apple/household/devices', undefined, fetchImpl);
  if (!r.ok) return r;
  const list = ((r.value ?? {}) as { devices?: unknown }).devices;
  if (!Array.isArray(list)) return { ok: false, reason: 'bad-response' };
  const devices: PilotDevice[] = [];
  for (const d of list as Record<string, unknown>[]) {
    const id = str(d?.id);
    const email = str(d?.email);
    if (!id || !email) continue;
    devices.push({
      id,
      email: email.toLowerCase(),
      name: str(d.name),
      label: str(d.label),
      created: str(d.created),
      expires: str(d.expires),
      lastUsed: str(d.lastUsed),
    });
  }
  return { ok: true, value: devices };
}

export async function revokePilotDevice(id: string, fetchImpl: typeof fetch = fetch): Promise<PilotResult<null>> {
  const r = await call('DELETE', `/api/apple/household/devices/${encodeURIComponent(id)}`, undefined, fetchImpl);
  return r.ok ? { ok: true, value: null } : r;
}

export async function setPilotSharing(
  email: string,
  enabled: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<PilotResult<{ sharing: boolean }>> {
  const r = await call('PUT', '/api/apple/household/sharing', { email: email.trim().toLowerCase(), enabled }, fetchImpl);
  if (!r.ok) return r;
  const b = (r.value ?? {}) as Record<string, unknown>;
  // The pilot stores sharing as 0/1; accept either spelling.
  const sharing = b.sharing === true || b.sharing === 1;
  return { ok: true, value: { sharing } };
}

/** What a page says about a failure, in words. */
export function pilotFailureText(reason: PilotFailure): string {
  switch (reason) {
    case 'unconfigured':
      return 'The app server is not configured on this host.';
    case 'refused':
      return 'The app server refused this site’s key.';
    case 'not-found':
      return 'The app server does not know that account.';
    case 'conflict':
      return 'That address belongs to another family on the app server.';
    default:
      return 'The app server is unreachable right now.';
  }
}

// ── Phase 2 (Contract F): what /welcome and /home/people call now the pilot's
// own dashboard is gone. Same lane, same token, same family scope.

/** What `household/data/delete` reports it removed. */
export interface PilotDeleted {
  /** Table → rows removed; empty when the pilot answered only `{ok:true}`. */
  counts: Record<string, number>;
}

/**
 * Wipe everything the phone uploaded for this person — health, tombstones,
 * locations, alerts, the device and pair credentials — and turn sharing off.
 * Exactly what the old dashboard's "Delete my data" did, asked for by the site
 * on their behalf. 404 = no account in the owner's family.
 */
export async function deletePilotData(email: string, fetchImpl: typeof fetch = fetch): Promise<PilotResult<PilotDeleted>> {
  const r = await call('POST', '/api/apple/household/data/delete', { email: email.trim().toLowerCase() }, fetchImpl);
  if (!r.ok) return r;
  const b = (r.value ?? {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  if (b.deleted && typeof b.deleted === 'object') {
    for (const [k, v] of Object.entries(b.deleted as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) counts[k] = v;
    }
  } else if (b.ok !== true) {
    // Neither shape the contract allows: do not report a deletion nobody confirmed.
    return { ok: false, reason: 'bad-response' };
  }
  return { ok: true, value: { counts } };
}

/**
 * A recorded fix, as the pilot sends it: a tuple, lng first as GeoJSON has it.
 * `[lng, lat, epochSeconds, accuracyMetres, moving (0|1), speedMetresPerSecond]`
 */
export type DayPoint = [number, number, number, number, number, number];

export interface DayActivity {
  kind: 'journey' | 'stop';
  /** Inclusive point indices. */
  first: number;
  last: number;
  /** Epoch seconds. */
  from: number;
  to: number;
  seconds: number;
  metres: number | null;
  fixes: number;
}

export interface DayTrack {
  /** The window, epoch seconds. */
  from: number;
  to: number;
  points: DayPoint[];
  /** Inclusive [first, last] index pairs of continuous recording. */
  segments: Array<[number, number]>;
  activities: DayActivity[];
  totals: { fixes: number; metres: number; movingSeconds: number; journeys: number };
  /** Longer than this between two fixes and the phone was asleep. */
  gapSeconds: number;
  retentionDays: number | null;
  truncated: boolean;
}

export interface DayTimeline {
  heartRate: { seconds: number; bins: Array<[number, number]> };
  restingHeartRate: { value: number; at: string } | null;
  steps: Array<{ value: number; start: string; end: string }>;
  workouts: Array<{ activity: string; start: string; end: string; seconds: number; distance: number | null }>;
  sleep: Array<{ stage: string; start: string; end: string }>;
}

export interface PilotDay {
  track: DayTrack;
  timeline: DayTimeline;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

function toPoint(v: unknown): DayPoint | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const [lng, lat, at, acc, moving, speed] = v as unknown[];
  if (typeof lng !== 'number' || typeof lat !== 'number' || typeof at !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(at)) return null;
  return [lng, lat, at, num(acc), moving ? 1 : 0, num(speed)];
}

/**
 * The pilot's track payload (the shape `GET /api/apple/track?date=` answers),
 * read defensively: a malformed point is dropped, and so is any segment or
 * activity whose indices do not land inside what was kept. PURE.
 */
export function toDayTrack(raw: unknown, window: { from: number; to: number }): DayTrack {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawPoints = list(b.points);
  const points = rawPoints.map(toPoint).filter((p): p is DayPoint => p !== null);
  // Indices refer to the pilot's list; if anything was dropped they no longer
  // line up, so segments and activities are rebuilt by the page instead.
  const aligned = points.length === rawPoints.length;
  const inRange = (i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < points.length;
  const segments = aligned
    ? list(b.segments).filter(
        (s): s is [number, number] => Array.isArray(s) && inRange(s[0]) && inRange(s[1]) && s[0] <= s[1],
      )
    : [];
  const activities: DayActivity[] = [];
  if (aligned) {
    for (const a of list(b.activities) as Array<Record<string, unknown> | null>) {
      if (!a || (a.kind !== 'journey' && a.kind !== 'stop') || !inRange(a.first) || !inRange(a.last)) continue;
      activities.push({
        kind: a.kind,
        first: a.first,
        last: a.last,
        from: num(a.from, points[a.first][2]),
        to: num(a.to, points[a.last][2]),
        seconds: num(a.seconds),
        metres: typeof a.metres === 'number' ? a.metres : null,
        fixes: num(a.fixes),
      });
    }
  }
  const t = (b.totals && typeof b.totals === 'object' ? b.totals : {}) as Record<string, unknown>;
  return {
    from: num(b.from, window.from),
    to: num(b.to, window.to),
    points,
    segments,
    activities,
    totals: {
      fixes: num(t.fixes, points.length),
      metres: num(t.metres),
      movingSeconds: num(t.movingSeconds),
      journeys: num(t.journeys, activities.filter((a) => a.kind === 'journey').length),
    },
    gapSeconds: num(b.gapSeconds, 600) || 600,
    retentionDays: typeof b.retentionDays === 'number' ? b.retentionDays : null,
    truncated: b.truncated === true,
  };
}

/** The pilot's timeline payload (the shape `GET /api/apple/timeline` answers), read defensively. PURE. */
export function toDayTimeline(raw: unknown): DayTimeline {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hr = (b.heartRate && typeof b.heartRate === 'object' ? b.heartRate : {}) as Record<string, unknown>;
  const bins = list(hr.bins).filter(
    (x): x is [number, number] =>
      Array.isArray(x) && typeof x[0] === 'number' && typeof x[1] === 'number' && Number.isFinite(x[0]) && Number.isFinite(x[1]),
  );
  const rest = (b.restingHeartRate ?? null) as Record<string, unknown> | null;
  const spans = (v: unknown) =>
    (list(v) as Array<Record<string, unknown> | null>).filter(
      (s): s is Record<string, unknown> & { start: string; end: string } => !!s && isIso(s.start) && isIso(s.end),
    );
  return {
    heartRate: { seconds: Math.max(1, num(hr.seconds, 300)), bins },
    restingHeartRate: rest && typeof rest.value === 'number' && isIso(rest.at) ? { value: rest.value, at: rest.at } : null,
    steps: spans(b.steps)
      .filter((s) => typeof s.value === 'number')
      .map((s) => ({ value: s.value as number, start: s.start, end: s.end })),
    workouts: spans(b.workouts).map((w) => ({
      activity: str(w.activity) ?? 'Workout',
      start: w.start,
      end: w.end,
      seconds: num(w.seconds, (Date.parse(w.end) - Date.parse(w.start)) / 1000),
      distance: typeof w.distance === 'number' ? w.distance : null,
    })),
    sleep: spans(b.sleep).map((s) => ({ stage: str(s.stage) ?? 'asleep', start: s.start, end: s.end })),
  };
}

/** A day window, epoch seconds, plus the browser's `getTimezoneOffset()`. */
export interface DayWindow {
  from: number;
  to: number;
  /** Minutes BEHIND UTC, as the browser reports it: British Summer Time is -60. */
  tz: number;
}

/**
 * One person's day as the old Movement tab drew it: the track (fixes,
 * continuous-recording segments, journeys and stops) and the health laid
 * against it (heart rate binned, sleep, workouts, step records). 404 = no
 * account in the owner's family.
 */
export async function pilotDay(email: string, window: DayWindow, fetchImpl: typeof fetch = fetch): Promise<PilotResult<PilotDay>> {
  const q = new URLSearchParams({
    email: email.trim().toLowerCase(),
    from: new Date(window.from * 1000).toISOString(),
    to: new Date(window.to * 1000).toISOString(),
    tz: String(window.tz),
  });
  const r = await call('GET', `/api/apple/household/day?${q}`, undefined, fetchImpl);
  if (!r.ok) return r;
  const b = (r.value ?? {}) as Record<string, unknown>;
  if (!b.track || typeof b.track !== 'object') return { ok: false, reason: 'bad-response' };
  return { ok: true, value: { track: toDayTrack(b.track, window), timeline: toDayTimeline(b.timeline) } };
}
