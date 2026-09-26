// src/lib/home/presence/companion.ts
//
// The iPhone app as a trail source. The phone uploads to the pilot; the pilot
// serves the household's fixes on its own lane (`GET /api/apple/household`,
// its own token), and `home-observe` pulls them from here every two minutes,
// writing each into the trail as source 'companion'.
//
// Consent lives on the pilot: a person with sharing off contributes no fixes
// and appears in `users` with `sharing: false`. We keep the latest users list
// so /home/people can say "not sharing" instead of showing a stale position as
// if it were current, and we never fall back to Life360 for them.
//
// The token is optional. Unset, `fetchHousehold` returns null without a
// request and ingest is skipped silently, which is the state of every host
// that is not production.

import { getSetting, setSetting } from '$lib/server/models/settings';
import { isPlausibleCoord, latestTsBySource, recordFix } from './observe';
import type { HouseholdMember } from './members';
import { errMsg, type IncomingFix } from './types';

export const COMPANION_DEFAULT_URL = 'http://127.0.0.1:5295';
export const COMPANION_CURSOR_KEY = 'home.presence.companionCursor';
export const COMPANION_USERS_KEY = 'home.presence.companionUsers';
/** Pages pulled per run at most; the rest waits two minutes for the next run. */
export const COMPANION_MAX_PAGES = 10;
const PAGE_LIMIT = 500;
const TIMEOUT_MS = 15_000;

export interface HouseholdUser {
  email: string;
  name: string;
  sharing: boolean;
}

export interface HouseholdFix {
  email: string;
  id: string;
  /** ISO8601, when the phone took the fix. */
  recorded: string;
  lat: number;
  lon: number;
  /** Metres. */
  accuracy: number | null;
  /** m/s; -1 or null when the phone did not know. */
  speed: number | null;
  moving: boolean;
}

export interface HouseholdPage {
  /** Opaque. Empty string means from the start. */
  cursor: string;
  more: boolean;
  users: HouseholdUser[];
  fixes: HouseholdFix[];
}

export interface CompanionResult {
  pages: number;
  written: number;
  /** Fixes whose email maps to no companion-source member. */
  dropped: number;
  /** Fixes with coordinates or a timestamp that could never be a row. */
  rejected: number;
  /** Fixes at or before the newest companion fix already in the trail for
   *  that person: a page re-read after a failure, or a late upload. */
  skipped: number;
  /** True when the page cap stopped the run with more waiting. */
  more: boolean;
  /** Set when a fetch or a write failed; the cursor stays on the failed page. */
  error?: string;
}

function companionUrl(): string {
  return (process.env.COMPANION_URL || COMPANION_DEFAULT_URL).replace(/\/+$/, '');
}

function companionToken(): string | null {
  const t = process.env.COMPANION_HOUSEHOLD_TOKEN?.trim();
  return t ? t : null;
}

function asPage(body: unknown): HouseholdPage {
  const b = (body ?? {}) as Partial<HouseholdPage>;
  if (typeof b.cursor !== 'string' || !Array.isArray(b.fixes)) {
    throw new Error('household page malformed: no cursor or fixes');
  }
  return {
    cursor: b.cursor,
    more: b.more === true,
    users: Array.isArray(b.users) ? b.users : [],
    fixes: b.fixes,
  };
}

/**
 * One page of household fixes from the pilot, after `since`. Null when no
 * token is configured (no request is made). Throws on any non-200, including
 * 401 (wrong token) and 404 (the pilot has no token set), so a refusal is
 * never mistaken for "nothing new".
 */
export async function fetchHousehold(
  since: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HouseholdPage | null> {
  const token = companionToken();
  if (!token) return null;
  const qs = new URLSearchParams({ since, limit: String(PAGE_LIMIT) });
  const res = await fetchImpl(`${companionUrl()}/api/apple/household?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`household lane answered ${res.status}`);
  return asPage(await res.json());
}

/** A pilot fix as the trail writer takes it. A negative or missing speed is
 *  unknown, and the writer then derives one from the previous fix. PURE. */
export function toIncomingFix(f: HouseholdFix): IncomingFix {
  const speed = typeof f.speed === 'number' && Number.isFinite(f.speed) && f.speed >= 0 ? f.speed : null;
  return {
    lat: f.lat,
    lon: f.lon,
    accuracyM: typeof f.accuracy === 'number' && Number.isFinite(f.accuracy) ? f.accuracy : null,
    at: f.recorded,
    speedKmh: speed == null ? null : Math.round(speed * 3.6 * 10) / 10,
  };
}

/** Companion-source members by lower-cased email. PURE. */
function companionByEmail(members: readonly HouseholdMember[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of members) {
    if (m.source === 'companion' && m.email) out.set(m.email.toLowerCase(), m.subject);
  }
  return out;
}

/**
 * Pull everything new from the pilot into the trail.
 *
 * Pages until `more` is false or the cap is reached. Each page's fixes are
 * written BEFORE its cursor is stored, so a crash between the two re-reads a
 * page rather than skipping one. A write failure stops the run with the cursor
 * still on that page. Null when no token is configured.
 */
export async function ingestCompanion(
  members: readonly HouseholdMember[],
  fetchImpl: typeof fetch = fetch,
  maxPages = COMPANION_MAX_PAGES,
): Promise<CompanionResult | null> {
  if (!companionToken()) return null;

  const bySubject = companionByEmail(members);
  const result: CompanionResult = { pages: 0, written: 0, dropped: 0, rejected: 0, skipped: 0, more: false };
  let cursor = (await getSetting<string>(COMPANION_CURSOR_KEY)) ?? '';
  let latest: Map<string, Date> | undefined;

  for (let i = 0; i < maxPages; i++) {
    let page: HouseholdPage | null;
    try {
      page = await fetchHousehold(cursor, fetchImpl);
    } catch (err) {
      result.error = errMsg(err);
      return result;
    }
    if (!page) return result.pages === 0 ? null : result;
    result.pages++;
    // Once per run, and only once there is something to compare against.
    // The phone uploads its queue in order, so dropping a fix older than the
    // newest one written loses only a late out-of-order upload, and makes a
    // re-read page idempotent.
    if (!latest) {
      try {
        latest = await latestTsBySource('companion', [...new Set(bySubject.values())]);
      } catch (err) {
        result.error = `could not read the trail: ${errMsg(err)}`;
        return result;
      }
    }

    await setSetting(COMPANION_USERS_KEY, page.users);

    for (const f of page.fixes) {
      const subject = bySubject.get(String(f.email ?? '').toLowerCase());
      if (!subject) {
        result.dropped++;
        continue;
      }
      const incoming = toIncomingFix(f);
      const recordedMs = Date.parse(f.recorded);
      if (!isPlausibleCoord(incoming.lat, incoming.lon) || Number.isNaN(recordedMs)) {
        result.rejected++;
        continue;
      }
      const newest = latest.get(subject);
      if (newest && recordedMs <= newest.getTime()) {
        result.skipped++;
        continue;
      }
      try {
        await recordFix(incoming, 'companion', subject);
        latest.set(subject, new Date(recordedMs));
        result.written++;
      } catch (err) {
        result.error = `write failed: ${errMsg(err)}`;
        return result;
      }
    }

    cursor = page.cursor;
    await setSetting(COMPANION_CURSOR_KEY, cursor);
    result.more = page.more;
    if (!page.more) break;
  }
  return result;
}

/**
 * Companion-source members not known to be sharing: their pilot user has
 * sharing off, or they are not in the pilot's users list at all. Such a person
 * is shown as not sharing, never as wherever their last fix happened to be.
 * PURE.
 *
 * Fails CLOSED: with no users list (never stored, or unreadable — the caller
 * passes null for both) nobody can be shown to have sharing ON, so every
 * companion-source member counts as not sharing. The old reading of null as
 * "nobody has sharing off" put a person who had switched it off back on the
 * page the moment the settings read failed.
 */
export function notSharingSubjects(
  members: readonly HouseholdMember[],
  users: readonly HouseholdUser[] | null | undefined,
): Set<string> {
  if (!Array.isArray(users)) {
    return new Set(members.filter((m) => m.source === 'companion').map((m) => m.subject));
  }
  // Sharing is shown only on a positive answer: a user row with sharing on.
  // Anyone on 'companion' who is absent from the list (or has no email to
  // look them up by) counts as not sharing, or their last fix — possibly an
  // old Life360 row — would be shown as live status.
  const on = new Set(
    users.filter((u) => u && u.sharing === true).map((u) => String(u.email).trim().toLowerCase()),
  );
  const out = new Set<string>();
  for (const m of members) {
    if (m.source !== 'companion') continue;
    if (!m.email || !on.has(m.email.trim().toLowerCase())) out.add(m.subject);
  }
  return out;
}

/** The latest users list the pilot sent, for `notSharingSubjects`. */
export async function loadCompanionUsers(): Promise<HouseholdUser[] | null> {
  const v = await getSetting<HouseholdUser[]>(COMPANION_USERS_KEY);
  return Array.isArray(v) ? v : null;
}
