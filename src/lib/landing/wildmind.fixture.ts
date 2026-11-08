// wildmind.fixture.ts — Wildmind for the local preview, before (or without) a
// Wildmind to read. Loaded only by wildmind.server.ts inside its `dev` branch,
// through a dynamic import, so a production build never carries it, and only
// when the preview sets LANDING_SHOWCASE_FIXTURE=1 with no WILDMIND_SNAPSHOT_URL.
//
// The ground is real: fixtures/wildmind-day16.json is a public snapshot built
// from a copy of generation three's save on day sixteen (names, enums and
// numbers only). On top of it the preview runs its own clock so the page can be
// seen by day and by night and with someone moving: game time passes at the
// unattended half speed (a day every sixteen minutes, cycling through four
// days), JKai takes a slow walk round his camp, and Wren works at hers.
// LANDING_WILDMIND_STATE picks the chapter's state (live, resting, paused,
// between-lives, stale, offline) for screenshots of each, and two more for
// the place view's model: `asleep` (a clear night in the valley, both of
// them asleep) and `young` (a valley only a day old, from the between-lives
// recording: a small first patch on a bare board).

import recorded from './fixtures/wildmind-day16.json';
import youngRecorded from './fixtures/wildmind-between-lives.json';
import { offlineShowcase, parseSnapshot, project, type WildmindShowcase, type WildmindSnapshotV1, type WildmindTerrain } from './wildmind';
import type { WildmindGlass } from './wildmind-glass';
import { glassCached } from './wildmind-glass.server';
import { traceCached } from './wildmind-trace.server';

const DAY = 1440;
/** Game minutes per real second at the unattended half speed (three a second at full). */
const PACE = 1.5;
const CYCLE = 4 * DAY;
const START = 23_208;
const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
const LENGTH = { spring: 13, summer: 16, autumn: 12, winter: 9 };

/** Wildmind's daylight curve (world.ts time()). */
function daylight(hour: number, season: (typeof SEASONS)[number]): number {
  const sunrise = 13 - LENGTH[season] / 2;
  const sunset = 13 + LENGTH[season] / 2;
  const d =
    hour < sunrise - 0.6 || hour > sunset + 0.6 ? 0 : hour < sunrise + 0.6 ? (hour - sunrise + 0.6) / 1.2 : hour > sunset - 0.6 ? (sunset + 0.6 - hour) / 1.2 : 1;
  return Math.max(0, Math.min(1, Math.round(d * 100) / 100));
}

/** JKai's walk: a slow loop round his camp, one point every five game minutes. */
function walkAt(minute: number, x: number, z: number): [number, number] {
  const a = Math.floor(minute / 5) * 0.12;
  return [Math.round((x + Math.sin(a) * 3) * 10) / 10, Math.round((z + Math.cos(a) * 3) * 10) / 10];
}

const base = parseSnapshot(recorded);
const youngBase = parseSnapshot(youngRecorded);

/** A valley a day old: the between-lives recording's ground, with both of them up and about on it. */
function youngSnapshot(): WildmindSnapshotV1 | null {
  if (!youngBase) return null;
  return {
    ...youngBase,
    status: 'running',
    time: { ...youngBase.time, daylight: 1, weather: 'clear' },
    people: youngBase.people.map((p) => ({ ...p, alive: true, activity: p.id === 'main' ? ('working' as const) : ('idle' as const) })),
    stats: { ...youngBase.stats, generation: youngBase.stats.generation + 1 },
  };
}

/** The recorded snapshot at `now`, with the preview's clock, walk and state. */
export function fixtureSnapshot(now: number, state?: string): WildmindSnapshotV1 | null {
  if (!base) return null;
  const minute = START + ((Math.floor(now / 1000) * PACE) % CYCLE);
  const day = Math.floor(minute / DAY);
  const hour = (minute % DAY) / 60;
  const season = SEASONS[Math.floor(day / 10) % 4];
  const [main, ...others] = base.people;
  const home = { x: main.x, z: main.z };
  const at = walkAt(minute, home.x, home.z);
  const trail = Array.from({ length: 12 }, (_, i) => walkAt(minute - (12 - i) * 5, home.x, home.z));
  if (state === 'young') return youngSnapshot();
  const ended = state === 'between-lives';
  const asleep = state === 'asleep';
  return {
    ...base,
    status: ended ? 'between-lives' : state === 'resting' ? 'resting' : state === 'paused' ? 'paused' : 'running',
    time: asleep
      ? { ...base.time, day, season, dayOfSeason: (day % 10) + 1, hour: 23, daylight: 0, weather: 'clear' }
      : { ...base.time, day, season, dayOfSeason: (day % 10) + 1, hour: Math.floor(hour), daylight: daylight(hour, season) },
    people: [
      ended
        ? { ...main, activity: 'dead', alive: false, trail: [] }
        : asleep
          ? { ...main, activity: 'sleeping', trail: [] }
          : { ...main, x: at[0], z: at[1], activity: 'walking', trail },
      ...others.map((p) => ({ ...p, activity: asleep ? ('sleeping' as const) : ('working' as const) })),
    ],
    stats: ended ? { ...base.stats, earlierLives: [{ n: null, days: day, cause: 'cold' as const }, ...base.stats.earlierLives] } : base.stats,
  };
}

/** The preview's Wildmind chapter data in the given state (live when unset or unknown). */
export function wildmindFixture(now: number, state?: string): WildmindShowcase {
  if (state === 'offline' || !base?.terrain) return offlineShowcase();
  const snap = fixtureSnapshot(now, state);
  if (!snap) return offlineShowcase();
  const fetchedAt = state === 'stale' ? now - 10 * 60_000 : now;
  const ground = state === 'young' && youngBase?.terrain ? youngBase : base;
  return project(snap, fetchedAt, now, traceCached(ground.terrain!, ground.terrainVersion));
}

/** The place view's model of the fixture's valley in the given state (the young valley's own for `young`). */
export function fixtureGlass(state?: string): WildmindGlass | null {
  const ground = state === 'young' && youngBase?.terrain ? youngBase : base;
  if (state === 'offline' || !ground?.terrain) return null;
  const traced = traceCached(ground.terrain, ground.terrainVersion);
  if (!traced) return null;
  return glassCached(ground.terrain, ground.terrainVersion, traced.frame.per / ground.terrain.step)?.glass ?? null;
}

/**
 * The preview's Wildmind as a raw read, for the phone's own route
 * (wildmind-native.server.ts): the snapshot without its terrain, the terrain
 * it stands on, and when it was "read". Null for `offline`.
 */
export function fixtureRead(now: number, state?: string): { snap: WildmindSnapshotV1; terrain: WildmindTerrain; fetchedAt: number } | null {
  if (state === 'offline') return null;
  const ground = state === 'young' && youngBase?.terrain ? youngBase : base;
  const full = fixtureSnapshot(now, state);
  if (!full || !ground?.terrain) return null;
  const { terrain: _, ...snap } = full;
  return { snap: { ...snap, terrainVersion: ground.terrainVersion }, terrain: ground.terrain, fetchedAt: state === 'stale' ? now - 10 * 60_000 : now };
}
