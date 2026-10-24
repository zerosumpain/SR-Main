// The "since you were away" time-lapse (spec §9.9): on open, the page replays
// the tile-log events since `lastSeenTick` as a 6–12 second accelerated
// animation — scaffolding going up, buildings rising, roads filling in. The
// map draws the town as it is now with a mask over every tile the replay has
// not reached yet, and lifts the mask event by event. Reduce Motion skips it.
//
// The schedule is a pure function of the tile log, so it is unit-tested; the
// player only advances a clock through it.

import { TILES, readTileLog, type TileEvent, type TileEventKind, type TownState } from './engine';
import { MASK_LOT, MASK_SCAFFOLD, MASK_SHOWN, MASK_TERRAIN } from './render/model';

export const LAPSE_MIN_MS = 6000;
export const LAPSE_MAX_MS = 12000;
/** Fewer events than this is not worth a replay. */
export const LAPSE_MIN_EVENTS = 3;

export interface LapseStep {
  /** ms from the start. */
  at: number;
  tile: number;
  mask: number;
  /** A sparkle where a building finished or grew. */
  sparkle: boolean;
}

export interface Lapse {
  durationMs: number;
  /** The mask before the first step. */
  start: Uint8Array;
  steps: LapseStep[];
}

/** What a tile looks like just after an event of this kind (null: the replay ignores it). */
function maskAfter(kind: TileEventKind): number | null {
  switch (kind) {
    case 'road':
      return MASK_SHOWN;
    case 'zoned':
      return MASK_LOT;
    case 'placed':
    case 'started':
      return MASK_SCAFFOLD;
    case 'built':
    case 'levelUp':
    case 'repaired':
      return MASK_SHOWN;
    default:
      return null;
  }
}

/** What a tile looked like before its first replayed event. */
function maskBefore(kind: TileEventKind): number {
  return kind === 'road' || kind === 'zoned' || kind === 'placed' ? MASK_TERRAIN : MASK_LOT;
}

/** The replay of `events` (oldest first), or null when there is too little to show. */
export function lapseOf(events: readonly TileEvent[]): Lapse | null {
  const shown = events.filter((e) => e.tile >= 0 && e.tile < TILES && maskAfter(e.kind) !== null);
  if (shown.length < LAPSE_MIN_EVENTS) return null;
  const durationMs = Math.min(LAPSE_MAX_MS, Math.max(LAPSE_MIN_MS, LAPSE_MIN_MS + shown.length * 12));
  const start = new Uint8Array(TILES);
  const last = new Map<number, number>();
  shown.forEach((e, k) => {
    if (!last.has(e.tile)) start[e.tile] = maskBefore(e.kind);
    last.set(e.tile, k);
  });
  // Steps spread over the replay by game time, with a little left at each end.
  const t0 = shown[0].tick;
  const span = Math.max(1, shown[shown.length - 1].tick - t0);
  const usable = durationMs * 0.9;
  const steps: LapseStep[] = shown.map((e, k) => ({
    at: Math.round(durationMs * 0.05 + (usable * (e.tick - t0)) / span + (k / shown.length) * 40),
    tile: e.tile,
    // Every tile ends exactly as the town is now.
    mask: last.get(e.tile) === k ? MASK_SHOWN : (maskAfter(e.kind) as number),
    sparkle: e.kind === 'built' || e.kind === 'levelUp',
  }));
  steps.sort((a, b) => a.at - b.at || a.tile - b.tile);
  return { durationMs, start, steps };
}

/** The replay since `fromTick` for a town (null: nothing worth showing, or Reduce Motion). */
export function lapseFor(t: TownState, fromTick: number, reduceMotion: boolean): Lapse | null {
  if (reduceMotion) return null;
  return lapseOf(readTileLog(t, Math.max(0, fromTick)));
}

/** Plays a Lapse against a clock: each call returns the mask now and the tiles that just sparkled. */
export class LapsePlayer {
  readonly mask: Uint8Array;
  private next = 0;
  private started = -1;
  /** Bumps whenever the mask changes (the map's repaint key). */
  version = 0;

  constructor(private readonly lapse: Lapse) {
    this.mask = lapse.start.slice();
  }

  get done(): boolean {
    return this.next >= this.lapse.steps.length;
  }

  /** Advances to `now` (ms). */
  step(now: number): number[] {
    if (this.started < 0) this.started = now;
    const e = now - this.started;
    const sparkles: number[] = [];
    while (this.next < this.lapse.steps.length && this.lapse.steps[this.next].at <= e) {
      const s = this.lapse.steps[this.next++];
      this.mask[s.tile] = s.mask;
      if (s.sparkle) sparkles.push(s.tile);
      this.version++;
    }
    return sparkles;
  }

  /** Jumps to the end (a tap skips the replay). */
  finish(): void {
    for (; this.next < this.lapse.steps.length; this.next++) this.mask[this.lapse.steps[this.next].tile] = this.lapse.steps[this.next].mask;
    this.mask.fill(MASK_SHOWN);
    this.version++;
  }
}
