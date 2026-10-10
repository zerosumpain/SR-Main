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
// Each process asks at most once per TTL (just under a second) however many
// people are reading (the memo shares the read in flight), answers from the
// last good read for a minute after a failure, and never makes the front door
// wait more than the showcase budget. The terrain is held by version and asked for with ?have=,
// so the steady pull is the small live layer only.
//
// Drawing: Wildmind's terrain version moves with every tile either of them
// sees, so while they explore it can move every second. The drawing (the
// traced map, its frame, the model under glass, the notes' pencilling) is
// held instead, and a version that only grew the valley is adopted at most
// every DRAW_HOLD_MS; until then the people are placed against the held
// frame. A new life or a change to the ground is adopted at once, as is a
// version whose people would stand off the held map. (Wildmind still sends
// the whole grid whenever its version moves past the one asked for with
// ?have=; only Wildmind can stop that.)

import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { memoised } from './showcase-data';
import { grownOnly, offlineShowcase, parseSnapshot, project, toMap, type WildmindShowcase, type WildmindSnapshotV1, type WildmindTerrain } from './wildmind';
import { traceCached, type Traced } from './wildmind-trace.server';
import { glassCached } from './wildmind-glass.server';
import type { WildmindGlass } from './wildmind-glass';
import { forNotes } from './notes-sheet.server';

/**
 * A view that wants the valley drawn its own way on the server: the notes
 * (the map pencilled, the words placed), the place (the model under glass).
 */
export type WildmindView = 'notes' | 'place';
export const WILDMIND_VIEWS: readonly WildmindView[] = ['notes', 'place'];

/** Abort an upstream read after this. */
export const TIMEOUT_MS = 1500;
/** Refuse a body bigger than this before parsing it. */
export const MAX_BYTES = 256 * 1024;

export interface WildmindRead {
  /** The snapshot, its terrainVersion the version drawn (which may trail Wildmind's while the valley grows). */
  snap: WildmindSnapshotV1;
  /** The terrain drawn, for that version. */
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

/** The place view's model for a read's terrain, once per version (and per trace resolution). */
function glassFor(terrain: WildmindTerrain, version: string, traced: Traced | null | undefined): WildmindGlass | null {
  if (!traced) return null;
  return glassCached(terrain, version, traced.frame.per / terrain.step)?.glass ?? null;
}

let held: { version: string; terrain: WildmindTerrain } | null = null;

/** How long a drawing stands while the valley only grows: the most often it is traced and modelled again. */
export const DRAW_HOLD_MS = 20_000;

/** The terrain drawn: its version, the trace (and so the frame people are placed by), and when it was adopted. */
let drawn: { version: string; terrain: WildmindTerrain; traced: Traced | null; at: number } | null = null;

/** Whether every living person in a snapshot stands on a traced map. */
function everyoneOn(snap: WildmindSnapshotV1, traced: Traced | null): boolean {
  if (!traced) return false;
  return snap.people.every((p) => {
    if (!p.alive) return true;
    const [x, y] = toMap(traced.frame, p.x, p.z);
    return x >= 0 && y >= 0 && x <= traced.map.w && y <= traced.map.h;
  });
}

/**
 * The drawing for a read: the one held while the valley has only grown
 * since it was made, it is younger than DRAW_HOLD_MS and everyone still
 * stands on it; otherwise this version, traced now.
 */
function drawingFor(snap: WildmindSnapshotV1, terrain: WildmindTerrain, now: number): NonNullable<typeof drawn> {
  const d = drawn;
  if (d && (d.version === snap.terrainVersion || (grownOnly(d.version, snap.terrainVersion) && now - d.at < DRAW_HOLD_MS && everyoneOn(snap, d.traced)))) return d;
  drawn = { version: snap.terrainVersion, terrain, traced: traceCached(terrain, snap.terrainVersion), at: now };
  return drawn;
}

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
  // Traced inside the read, so the memo's page budget covers it; the model under glass
  // is built only when the place view first asks for this version (finish).
  const d = drawingFor(snap, terrain, now.getTime());
  return { snap: { ...rest, terrainVersion: d.version }, terrain: d.terrain, fetchedAt: now.getTime(), traced: d.traced };
}

/**
 * How long one read answers for. Just under a second, so a reader handling
 * the map (polling every second) sees the valley move, while the process asks
 * Wildmind at most about once a second however many people poll (its public
 * listener allows three a second per address). The read in flight is shared,
 * and a failure is answered from the last good read for RETRY_MS before
 * Wildmind is asked again.
 */
export const TTL_MS = 900;
/** After a failed read, ask again no sooner than this. */
export const RETRY_MS = 60_000;
/**
 * The poll route's caching, matched to the memo: a reader polling every
 * second while they handle the map gets each new frame, and a shared cache
 * may answer a burst from one.
 */
export const CACHE_CONTROL = 'public, max-age=1, stale-while-revalidate=5';

export const readWildmind = memoised<WildmindRead | null>((now) => loadWildmind(now), {
  name: 'wildmind',
  ttlMs: TTL_MS,
  budgetMs: 400,
  retryMs: RETRY_MS,
  fallback: null,
});

/** Forget the held and drawn terrain and the memo (tests only). */
export function resetWildmind(): void {
  held = null;
  drawn = null;
  readWildmind.reset();
}

/** The model under glass, or null if building it fails: a fault there never costs the other views their chapter. */
function safely(glass?: () => WildmindGlass | null): WildmindGlass | null {
  try {
    return glass?.() ?? null;
  } catch (err) {
    console.error(`[landing] wildmind glass failed: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`);
    return null;
  }
}

/**
 * The projection as a view gets it: drawn for the notes when they asked, as
 * the model under glass (and no flat map) for the place, and with the
 * drawing left out when the caller already has this version.
 */
function finish(sc: WildmindShowcase, have?: string | null, view?: WildmindView | null, glass?: () => WildmindGlass | null): WildmindShowcase {
  const held = !!have && sc.mapVersion === have;
  if (view === 'place') return { ...sc, map: null, glass: held || !sc.mapVersion ? null : safely(glass) };
  const out = view === 'notes' ? forNotes(sc) : sc;
  return have && out.mapVersion === have ? { ...out, map: null } : out;
}

/** The read projected for the page, with the map left out when the caller already has this version. */
export function showcaseFrom(read: WildmindRead | null, now: number, have?: string | null, view?: WildmindView | null): WildmindShowcase {
  if (!read) return offlineShowcase();
  const traced = read.traced !== undefined ? read.traced : traceCached(read.terrain, read.snap.terrainVersion);
  return finish(project(read.snap, read.fetchedAt, now, traced), have, view, () => glassFor(read.terrain, read.snap.terrainVersion, traced));
}

function wantsFixture(): boolean {
  return dev && env.LANDING_SHOWCASE_FIXTURE === '1';
}

export const FIXTURE_STATES = ['live', 'asleep', 'young', 'resting', 'paused', 'between-lives', 'stale', 'offline'] as const;
/** The dev-only cookie a preview's ?wm= is kept in, so each browser pins its own state and nobody else's. */
export const FIXTURE_COOKIE = 'sr-wm-fixture';

const known = (s: string | null | undefined): string | undefined => (s && (FIXTURE_STATES as readonly string[]).includes(s) ? s : undefined);

/**
 * Dev only: `?wm=<state>` on the page pins the preview's fixture to that state
 * (FIXTURE_STATES) for this browser, the page and every poll after it (a
 * cookie, so other people using the same preview keep their own); `?wm=env`
 * hands it back to LANDING_WILDMIND_STATE. Returns the state for this
 * request, or undefined. Ignored in production and without the fixture.
 */
export function pinFixtureState(cookies: Pick<Cookies, 'get' | 'set' | 'delete'>, query: string | null, isDev = dev): string | undefined {
  if (!isDev || !wantsFixture()) return undefined;
  if (query === 'env') {
    cookies.delete(FIXTURE_COOKIE, { path: '/' });
    return undefined;
  }
  const asked = known(query);
  if (asked) cookies.set(FIXTURE_COOKIE, asked, { path: '/', httpOnly: true, sameSite: 'lax', secure: false });
  return asked ?? known(cookies.get(FIXTURE_COOKIE));
}

/** Dev only: the state this browser pinned with ?wm= (pinFixtureState), for its polls. */
export function pinnedFixtureState(cookies: Pick<Cookies, 'get'>, isDev = dev): string | undefined {
  return isDev && wantsFixture() ? known(cookies.get(FIXTURE_COOKIE)) : undefined;
}

/**
 * Wildmind for the page: null only when it is not configured (no chapter),
 * otherwise always an answer, `offline` when it has never been read. Never throws.
 * `view` 'notes' draws the map for the notes view on the server (forNotes),
 * 'place' builds the model under glass instead of the map.
 * In a local preview with LANDING_SHOWCASE_FIXTURE=1 and no address, the
 * recorded day-16 fixture stands in (LANDING_WILDMIND_STATE, or the state a
 * browser pinned with ?wm=, `pinned`, picks its state).
 */
export async function wildmindShowcase(now = new Date(), have?: string | null, view?: WildmindView | null, pinned?: string): Promise<WildmindShowcase | null> {
  const fixtureState = dev ? known(pinned) : undefined;
  if (!env.WILDMIND_SNAPSHOT_URL && !wantsFixture()) return null;
  try {
    if (!env.WILDMIND_SNAPSHOT_URL) {
      const { wildmindFixture, fixtureGlass } = await import('./wildmind.fixture');
      const state = fixtureState ?? env.LANDING_WILDMIND_STATE;
      return finish(wildmindFixture(now.getTime(), state), have, view, () => fixtureGlass(state));
    }
    return showcaseFrom(await readWildmind(now), now.getTime(), have, view);
  } catch (err) {
    // A fault here is ours, not Wildmind's; the page still answers, honestly.
    console.error(`[landing] wildmind projection failed: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`);
    return offlineShowcase();
  }
}
