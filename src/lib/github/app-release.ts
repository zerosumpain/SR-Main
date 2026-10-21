// Which build of the iPhone app the family's phones are offered — the owner's
// call, made on /admin/access/app (John, 2026-10-21: "control when versions
// are pushed to phones").
//
// The family run the AD-HOC copy (`$lib/server/adhoc-install`): /app and
// /install hand it out, and every copy asks /api/native/app-update hourly
// whether a newer one is ready. Until now all three offered the NEWEST copy,
// so a merge to SR-AppleApp's `main` reached every phone within the hour.
// Now they offer the RELEASED one. A newer build waits — the owner tries it on
// TestFlight — until he releases it; an older one can be released to roll back
// (a phone already on a later build is never offered an earlier one: the app
// only prompts for a later build).
//
// Two rules keep that from getting in anybody's way:
//  - Nothing changes on the day this ships: with no release recorded, the
//    newest copy at that moment is pinned as released (`pinned`).
//  - A rebuild of the released COMMIT follows it automatically. Enrolling a
//    phone rebuilds the copy so its UDID is in the profile; the code is the
//    same, and the new phone cannot install a copy that does not list it.

import { getSetting, setSetting } from '$lib/server/models/settings';
import { adhocBuildOf, listAdhocDrafts, type AdhocBuild, type AdhocDraft } from './adhoc-builds';

export const RELEASE_KEY = 'app_release';
/** Releases remembered on the page. */
export const HISTORY_LIMIT = 20;

export type ReleaseKind = 'release' | 'rollback' | 'pinned';

export interface ReleaseEntry {
  build: number;
  commit: string | null;
  at: string;
  /** Who pressed it; null when the site pinned it itself. */
  by: string | null;
  kind: ReleaseKind;
}

export interface AppRelease {
  build: number;
  commit: string | null;
  at: string;
  by: string | null;
  history: ReleaseEntry[];
}

/** A stored value, read leniently: anything malformed is no release. PURE. */
export function readRelease(value: unknown): AppRelease | null {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (!o || typeof o.build !== 'number' || !Number.isInteger(o.build) || o.build <= 0) return null;
  const history = Array.isArray(o.history)
    ? o.history.filter((h): h is ReleaseEntry => !!h && typeof h === 'object' && typeof (h as ReleaseEntry).build === 'number')
    : [];
  return {
    build: o.build,
    commit: typeof o.commit === 'string' ? o.commit : null,
    at: typeof o.at === 'string' ? o.at : new Date(0).toISOString(),
    by: typeof o.by === 'string' ? o.by : null,
    history,
  };
}

/**
 * The copy the family are offered, from the copies GitHub still holds (newest
 * first). PURE.
 *
 * The released build itself — or a later rebuild of the same commit, which is
 * the same app with more phones in its profile. If GitHub no longer holds the
 * released build (only the newest few are kept), the newest copy of its
 * commit; failing that, nothing — never a build nobody released.
 */
export function chooseReleased(drafts: readonly AdhocDraft[], release: Pick<AppRelease, 'build' | 'commit'>): AdhocDraft | null {
  if (release.commit) {
    const sameCommit = drafts.filter((d) => d.commit === release.commit && d.run >= release.build);
    if (sameCommit.length) return sameCommit[0];
  }
  return drafts.find((d) => d.run === release.build) ?? (release.commit ? drafts.find((d) => d.commit === release.commit) ?? null : null);
}

/** The record after releasing `draft`. PURE. */
export function released(previous: AppRelease | null, draft: AdhocDraft, by: string | null, now: Date, kind?: ReleaseKind): AppRelease {
  const entry: ReleaseEntry = {
    build: draft.run,
    commit: draft.commit,
    at: now.toISOString(),
    by,
    kind: kind ?? (previous && draft.run < previous.build ? 'rollback' : 'release'),
  };
  return {
    build: draft.run,
    commit: draft.commit,
    at: entry.at,
    by,
    history: [entry, ...(previous?.history ?? [])].slice(0, HISTORY_LIMIT),
  };
}

/** Where each copy GitHub holds stands against the release. PURE. */
export function buildState(draft: AdhocDraft, release: AppRelease | null, offered: AdhocDraft | null): 'released' | 'waiting' | 'older' {
  if (offered && draft.run === offered.run) return 'released';
  if (!release) return 'waiting';
  return draft.run > (offered?.run ?? release.build) ? 'waiting' : 'older';
}

/** What is recorded, with the first-read pin applied. */
export async function currentRelease(drafts?: readonly AdhocDraft[], now = new Date()): Promise<AppRelease | null> {
  const stored = readRelease(await getSetting(RELEASE_KEY));
  if (stored) return stored;
  // First read since release control shipped: pin what the family already
  // get, so nothing changes until the owner releases something.
  const list = drafts ?? (await listAdhocDrafts());
  if (!list.length) return null;
  const pin = released(null, list[0], null, now, 'pinned');
  await setSetting(RELEASE_KEY, pin);
  return pin;
}

/**
 * The copy /app, /install and the update check offer: the released one, with
 * its build.json read. Null when nothing is built, or the released build is
 * gone from GitHub (the admin page says so).
 */
export async function releasedAdhocBuild(): Promise<AdhocBuild | null> {
  const drafts = await listAdhocDrafts();
  const release = await currentRelease(drafts);
  if (!release) return null;
  const offered = chooseReleased(drafts, release);
  return offered ? adhocBuildOf(offered) : null;
}

export type ReleaseOutcome = { ok: true; release: AppRelease } | { ok: false; error: string };

/** Release (or roll back to) build `run` for the family. */
export async function releaseBuild(run: number, by: string | null, now = new Date()): Promise<ReleaseOutcome> {
  const drafts = await listAdhocDrafts(true);
  const draft = drafts.find((d) => d.run === run);
  if (!draft) return { ok: false, error: `Build ${run} is not among the copies GitHub holds.` };
  const previous = readRelease(await getSetting(RELEASE_KEY));
  if (previous && previous.build === run) return { ok: true, release: previous };
  const next = released(previous, draft, by, now);
  await setSetting(RELEASE_KEY, next);
  return { ok: true, release: next };
}
