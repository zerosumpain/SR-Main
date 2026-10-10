// wildmind.server.ts — the landing page's one read of Wildmind's public
// snapshot, for the SSR first frame (showcase.server.ts) and the poll
// (/api/landing/wildmind).
//
// The address is WILDMIND_SNAPSHOT_URL, set only where the site runs (the
// VPS's runtime env, the local preview's compose file). There is no default
// and no address in code: unset, there is no chapter and no request. The read
// is a fixed GET: nothing from the visitor (query, headers, method, body) is
// ever passed upstream, redirects are refused, the body is capped and checked
// by parseSnapshot before anything is kept.
//
// Each process asks at most once per TTL however many people are reading (the
// memo shares the read in flight), answers from the last good read for a
// minute after a failure, and never makes the front door wait more than the
// showcase budget. The terrain is held by version and asked for with ?have=,
// so the steady pull is the small live layer only.

import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { memoised } from './showcase-data';
import { offlineShowcase, parseSnapshot, project, type WildmindShowcase, type WildmindSnapshotV1, type WildmindTerrain } from './wildmind';
import { traceCached, type Traced } from './wildmind-trace.server';
import { forNotes } from './notes-sheet.server';

/** A view that wants the map drawn its own way on the server: the notes (pencilled, words placed). */
export type WildmindView = 'notes';
export const WILDMIND_VIEWS: readonly WildmindView[] = ['notes'];

/** Abort an upstream read after this. */
export const TIMEOUT_MS = 1500;
/** Refuse a body bigger than this before parsing it. */
export const MAX_BYTES = 256 * 1024;

export interface WildmindRead {
  snap: WildmindSnapshotV1;
  terrain: WildmindTerrain;
  /** Server clock at the read. Never sent to the browser. */
  fetchedAt: number;
  /**
   * The terrain traced (once per version), inside the read so the memo's page
   * budget covers it and a request never traces on its own thread. Absent on
   * a read made by hand (tests): showcaseFrom then traces it.
   */
  traced?: Traced | null;
}

let held: { version: string; terrain: WildmindTerrain } | null = null;

/** The body as text, refused once it passes `max` bytes. */
async function cappedText(res: Response, max: number): Promise<string> {
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > max) {
    await res.body?.cancel().catch(() => {});
    throw new Error('too large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error('too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchSnapshot(base: string, have: string | null): Promise<WildmindSnapshotV1> {
  const url = new URL(base);
  if (have) url.searchParams.set('have', have);
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // Let the connection go rather than leave an unread body holding it.
    await res.body?.cancel().catch(() => {});
    throw new Error(`status ${res.status}`);
  }
  const snap = parseSnapshot(JSON.parse(await cappedText(res, MAX_BYTES)));
  if (!snap) throw new Error('not a wildmind snapshot');
  return snap;
}

/** One upstream read: the snapshot, with the terrain it left out filled from what is held. */
export async function loadWildmind(now: Date, base = env.WILDMIND_SNAPSHOT_URL): Promise<WildmindRead | null> {
  if (!base) return null;
  let snap = await fetchSnapshot(base, held?.version ?? null);
  let terrain = snap.terrain ?? (held && held.version === snap.terrainVersion ? held.terrain : null);
  if (!terrain) {
    // Asked with a version it no longer recognised and answered without terrain: ask once in full.
    snap = await fetchSnapshot(base, null);
    terrain = snap.terrain ?? null;
    if (!terrain) throw new Error('no terrain');
  }
  held = { version: snap.terrainVersion, terrain };
  // The terrain lives in `held` and the read; the snapshot itself need not carry it twice.
  const { terrain: _, ...rest } = snap;
  return { snap: rest, terrain, fetchedAt: now.getTime(), traced: traceCached(terrain, snap.terrainVersion) };
}

export const readWildmind = memoised<WildmindRead | null>((now) => loadWildmind(now), {
  name: 'wildmind',
  ttlMs: 20_000,
  budgetMs: 400,
  retryMs: 60_000,
  fallback: null,
});

/** Forget the held terrain and the memo (tests only). */
export function resetWildmind(): void {
  held = null;
  readWildmind.reset();
}

/**
 * The projection as a view gets it: drawn for the notes when they asked, and
 * with the map left out when the caller already has this version.
 */
function finish(sc: WildmindShowcase, have?: string | null, view?: WildmindView | null): WildmindShowcase {
  const out = view === 'notes' ? forNotes(sc) : sc;
  return have && out.mapVersion === have ? { ...out, map: null } : out;
}

/** The read projected for the page, with the map left out when the caller already has this version. */
export function showcaseFrom(read: WildmindRead | null, now: number, have?: string | null, view?: WildmindView | null): WildmindShowcase {
  if (!read) return offlineShowcase();
  const traced = read.traced !== undefined ? read.traced : traceCached(read.terrain, read.snap.terrainVersion);
  return finish(project(read.snap, read.fetchedAt, now, traced), have, view);
}

function wantsFixture(): boolean {
  return dev && env.LANDING_SHOWCASE_FIXTURE === '1';
}

/**
 * Wildmind for the page: null only when it is not configured (no chapter),
 * otherwise always an answer, `offline` when it has never been read. Never throws.
 * `view` 'notes' draws the map for the notes view on the server (forNotes).
 * In a local preview with LANDING_SHOWCASE_FIXTURE=1 and no address, the
 * recorded day-16 fixture stands in (LANDING_WILDMIND_STATE picks its state).
 */
export async function wildmindShowcase(now = new Date(), have?: string | null, view?: WildmindView | null): Promise<WildmindShowcase | null> {
  if (!env.WILDMIND_SNAPSHOT_URL && !wantsFixture()) return null;
  try {
    if (!env.WILDMIND_SNAPSHOT_URL) {
      const { wildmindFixture } = await import('./wildmind.fixture');
      return finish(wildmindFixture(now.getTime(), env.LANDING_WILDMIND_STATE), have, view);
    }
    return showcaseFrom(await readWildmind(now), now.getTime(), have, view);
  } catch (err) {
    // A fault here is ours, not Wildmind's; the page still answers, honestly.
    console.error(`[landing] wildmind projection failed: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`);
    return offlineShowcase();
  }
}
