// src/lib/home/presence/now.ts
//
// What /home/people says about each person right now, and the three counts in
// its hero. PURE — no database, no clock of its own (`ageMins` is computed in
// the load).
//
// The rule the counts obey: every SHARING person is exactly one of home, out
// or unknown, so the three always sum to the number of people sharing. The
// old counts put a stale fix in both "home" and "unknown" and read 6 of 5.
//   - home    = a fresh fix, at home
//   - out     = a fresh fix, not at home
//   - unknown = a stale fix, no fix at all, or a fix with no home answer
// Someone not sharing is none of the three: "off".

/** Over this many minutes without a fix, where they are is "we don't know". */
export const STALE_MINS = 30;

export type NowStatus = 'home' | 'out' | 'unknown' | 'off';

/** The fields of a card this module reads — a `ScopedPresence` fits. */
export interface NowFields {
  notSharing?: boolean;
  sharingUnknown?: boolean;
  isHome: boolean | null;
  placeLabel: string | null;
  distanceHomeKm: number | null;
  ageMins: number | null;
}

export function nowStatus(m: NowFields, staleMins = STALE_MINS): NowStatus {
  if (m.notSharing) return 'off';
  if (m.ageMins == null || m.ageMins > staleMins) return 'unknown';
  // A fresh fix that cannot say whether it is at home is not "out".
  if (m.isHome == null) return 'unknown';
  return m.isHome ? 'home' : 'out';
}

/** An older location is still a known place, without claiming it is current. */
export function nowLabel(m: NowFields): string {
  const status = nowStatus(m);
  if (status === 'unknown') return m.ageMins == null ? 'no location' : 'last known';
  return status;
}

/** Reading the app server is not a new GPS confirmation from the phone. */
export function feedCheckText(
  check: { source: 'companion' | 'life360'; checkedAt: Date | string | null } | undefined,
  now: Date,
): string | null {
  if (!check) return null;
  const label = check.source === 'companion' ? 'App feed' : 'HA feed';
  const at = check.checkedAt == null ? NaN : new Date(check.checkedAt).getTime();
  if (!Number.isFinite(at)) return `${label} check unavailable`;
  const seconds = Math.max(0, Math.floor((now.getTime() - at) / 1000));
  const age = seconds < 5 ? 'just now'
    : seconds < 60 ? `${seconds}s ago`
    : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago`
    : since(Math.floor(seconds / 60));
  return `${label} checked ${age}`;
}

export interface NowCounts {
  home: number;
  out: number;
  unknown: number;
  /** home + out + unknown, always. */
  sharing: number;
  notSharing: number;
}

export function nowCounts(members: readonly NowFields[], staleMins = STALE_MINS): NowCounts {
  const c: NowCounts = { home: 0, out: 0, unknown: 0, sharing: 0, notSharing: 0 };
  for (const m of members) {
    const s = nowStatus(m, staleMins);
    if (s === 'off') {
      c.notSharing++;
      continue;
    }
    c[s]++;
    c.sharing++;
  }
  return c;
}

/** "just now", "47m ago", "3h ago", "2d ago"; "never" with no fix. */
export function since(mins: number | null): string {
  if (mins == null) return 'never';
  if (mins < 5) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Where the last fix put them: a named place, home, or a distance. */
function where(m: NowFields): string | null {
  if (m.placeLabel) return m.placeLabel;
  if (m.isHome) return 'home';
  if (m.distanceHomeKm != null) return `${m.distanceHomeKm} km from home`;
  return null;
}

/**
 * The line under a card's status. A fresh fix: "At Elton Parade · location 3m
 * ago". A stale one says it is the LAST place, not the current one: "Last at
 * Elton Parade · 47m ago".
 */
export function nowSub(m: NowFields, staleMins = STALE_MINS): string {
  const status = nowStatus(m, staleMins);
  if (status === 'off') {
    return m.sharingUnknown ? 'Sharing unknown: the app’s sharing list could not be read.' : 'Not sharing their location.';
  }
  if (m.ageMins == null) return 'No location received.';
  const place = where(m);
  const km = place != null && !m.placeLabel && !m.isHome;
  if (status === 'unknown') {
    if (place == null) return `Location ${since(m.ageMins)}`;
    return `Last ${km ? '' : 'at '}${place} · location ${since(m.ageMins)}`;
  }
  if (place == null) return `Location ${since(m.ageMins)}`;
  return `${km ? cap(place) : `At ${place}`} · location ${since(m.ageMins)}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
