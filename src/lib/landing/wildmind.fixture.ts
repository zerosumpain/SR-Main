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
// between-lives, stale, offline) for screenshots of each.

import recorded from './fixtures/wildmind-day16.json';
import { offlineShowcase, parseSnapshot, project, type WildmindShowcase, type WildmindSnapshotV1 } from './wildmind';
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
  const ended = state === 'between-lives';
  return {
    ...base,
    status: ended ? 'between-lives' : state === 'resting' ? 'resting' : state === 'paused' ? 'paused' : 'running',
    time: { ...base.time, day, season, dayOfSeason: (day % 10) + 1, hour: Math.floor(hour), daylight: daylight(hour, season) },
    people: [
      ended
        ? { ...main, activity: 'dead', alive: false, trail: [] }
        : { ...main, x: at[0], z: at[1], activity: 'walking', trail },
      ...others.map((p) => ({ ...p, activity: 'working' as const })),
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
  return project(snap, fetchedAt, now, traceCached(base.terrain, base.terrainVersion));
}
