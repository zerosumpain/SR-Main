// wildmind-native.server.ts — Wildmind for the owner's iPhone
// (GET /api/native/wildmind), straight from the landing page's memoised read.
//
// The landing poll sends the valley as traced SVG paths in map units, which a
// SwiftUI Canvas cannot shade or recolour per terrain. This sends the parsed
// snapshot itself (world tiles, every stat) and the raw terrain grids beside
// it, so the app draws its own map. It reads through readWildmind, the same
// per-process memo the landing page uses, so the phone never adds a request to
// Wildmind's public listener.
//
// Nothing here widens what crosses: the snapshot has been through
// parseSnapshot (every field copied by hand, unknown keys dropped, names
// bounded by boundName), so no thought, speech, mood, plan, description or
// activity label can reach the phone. The only field added is each person's
// fixed DOING word, so the app need not keep its own copy of the mapping.
//
// Lives in $lib/landing (ui), not $lib/server: platform may not import ui.

import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { doingOf, stateOf, type WildmindSnapshotPerson, type WildmindSnapshotV1, type WildmindState, type WildmindTerrain } from './wildmind';
import { readWildmind, wantsFixture } from './wildmind.server';

/** A terrain version the caller says it holds; anything else is ignored. */
const VERSION = /^[A-Za-z0-9._:-]{1,64}$/;

export type NativeWildmindPerson = WildmindSnapshotPerson & {
  /** A fixed word from DOING ("asleep", "at work", "busy", "dead"). */
  doing: string;
};

/** The parsed snapshot, without its terrain (sent beside it), each person with their DOING word. */
export type NativeWildmindSnapshot = Omit<WildmindSnapshotV1, 'terrain' | 'people'> & { people: NativeWildmindPerson[] };

export interface NativeWildmind {
  state: WildmindState;
  /** Seconds since the read this answers from; null with no read. */
  ageSeconds: number | null;
  /** Null when Wildmind is not configured, has never answered, or was last read over a day ago. */
  snapshot: NativeWildmindSnapshot | null;
  /** The grid for `snapshot.terrainVersion`; null when the caller sent that version as ?have=, or with no snapshot. */
  terrain: WildmindTerrain | null;
}

export const NATIVE_WILDMIND_OFFLINE: Readonly<NativeWildmind> = Object.freeze({ state: 'offline', ageSeconds: null, snapshot: null, terrain: null });

const offline = (): NativeWildmind => ({ ...NATIVE_WILDMIND_OFFLINE });

/** A read as the phone gets it. */
export function nativeFrom(
  read: { snap: WildmindSnapshotV1; terrain: WildmindTerrain; fetchedAt: number } | null,
  now: number,
  have: string | null,
): NativeWildmind {
  if (!read) return offline();
  const state = stateOf(read.snap.status, read.fetchedAt, now);
  if (state === 'offline') return offline();
  const { terrain: _, people, ...rest } = read.snap;
  const snapshot: NativeWildmindSnapshot = { ...rest, people: people.map((p) => ({ ...p, doing: doingOf(p) })) };
  const held = !!have && VERSION.test(have) && have === snapshot.terrainVersion;
  return { state, ageSeconds: Math.max(0, Math.round((now - read.fetchedAt) / 1000)), snapshot, terrain: held ? null : read.terrain };
}

/**
 * Wildmind for the phone. Offline (and no request) when WILDMIND_SNAPSHOT_URL
 * is unset; in a local preview with LANDING_SHOWCASE_FIXTURE=1 and no address,
 * the recorded day-16 fixture stands in (LANDING_WILDMIND_STATE picks its
 * state). Never throws: a fault here answers offline.
 */
export async function nativeWildmind(now: Date, have: string | null): Promise<NativeWildmind> {
  try {
    if (!env.WILDMIND_SNAPSHOT_URL) {
      if (!(dev && wantsFixture())) return offline();
      const { fixtureRead } = await import('./wildmind.fixture');
      return nativeFrom(fixtureRead(now.getTime(), env.LANDING_WILDMIND_STATE), now.getTime(), have);
    }
    return nativeFrom(await readWildmind(now), now.getTime(), have);
  } catch (err) {
    console.error(`[native] wildmind failed: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]}`);
    return offline();
  }
}
