// Exact local ticks (spec §10.9) and the production canary (§10.4 item 8).
// Between Regional Days a town depends only on its own state, its owner's
// moves, the snapshot and the tick count, so the page can run its own copy
// forward at each tick boundary and show pay day and finished buildings with
// no server traffic. The next server frame then names the server's hash at
// its tick; if the page predicted that same tick it compares the two, and a
// mismatch switches prediction off (the page then only draws server state)
// and is reported to the app.
//
// The town is ticked with exactly the context the server builds
// (townContext with the tick's grid end instant), never past the next
// Regional Day, whose snapshot the page cannot know.

import { paramsFor, stateHash, tickTown, townContext, type Snapshot, type TownEnv, type TownState } from '../engine';
import type { MeWire } from '../engine';

export type PredictInfo = NonNullable<MeWire['predict']>;

export interface PredictClock {
  tickMs: number;
  /** Completed county grid ticks at the frame (the wire's clock.gridTick). */
  gridTick: number;
  /** The instant grid tick `gridTick` completes (the wire's clock.nextTickAt). */
  nextTickAt: number;
  nextRegionalDayAt: number;
  paused: boolean;
  napping: boolean;
}

/** How many predicted hashes to remember for the canary. */
const KEEP = 24;
/** Most ticks run in one advance call (a phone woken after a long sleep waits for the server instead). */
const MAX_TICKS_PER_CALL = 8;

export type CanaryResult = { tick: number; ok: boolean; hash: string } | null;

export class Predictor {
  /** False after a canary mismatch: the page then draws server state only. */
  enabled = true;
  private hashes: { tick: number; hash: string }[] = [];
  private nextAt = 0;
  private env: TownEnv | null = null;
  /** True while a local change the server has not confirmed is applied (the canary would be unfair). */
  dirty = false;

  town: TownState;
  private info: PredictInfo;
  private clock: PredictClock;

  constructor(town: TownState, info: PredictInfo, snapshot: Snapshot, clock: PredictClock) {
    this.town = town;
    this.info = info;
    this.clock = clock;
    this.reset(town, info, snapshot, clock);
  }

  /** A new server town replaces the predicted one (the server is always the authority). */
  reset(town: TownState, info: PredictInfo, snapshot: Snapshot, clock: PredictClock): void {
    this.town = town;
    this.info = info;
    this.clock = clock;
    // Town tick k runs at grid tick gridBase + k (§2.3: a town joins the grid at the boundary after its
    // last sprint), so the next one is due when that grid tick completes, not always at nextTickAt.
    const g = town.gridBase === null ? clock.gridTick : town.gridBase + town.tick;
    this.nextAt = clock.nextTickAt + (g - clock.gridTick) * clock.tickMs;
    this.env = { params: paramsFor(info.paramsVersion), snapshot, rivalry: info.rivalry, mishaps: info.mishaps, dayIndex: info.dayIndex };
    this.dirty = false;
  }

  /** The instant the next predicted tick is due, or null when none will run (paused, fortnight, day end). */
  nextDue(): number | null {
    if (!this.enabled || this.clock.paused || this.clock.napping || this.town.gridBase === null) return null;
    if (this.nextAt > this.clock.nextRegionalDayAt) return null;
    return this.nextAt;
  }

  /** Runs every tick whose boundary has passed by `now`. Returns how many ran. */
  advance(now: number): number {
    let n = 0;
    while (n < MAX_TICKS_PER_CALL) {
      const due = this.nextDue();
      if (due === null || due > now || !this.env) break;
      const t = this.town;
      tickTown(t, townContext(t, this.info.townIndex, t.tick, this.env, due, false));
      this.nextAt = due + this.clock.tickMs;
      if (!this.dirty) {
        this.hashes.push({ tick: t.tick, hash: stateHash(t) });
        while (this.hashes.length > KEEP) this.hashes.shift();
      }
      n++;
    }
    return n;
  }

  /**
   * The canary: the server's hash for its town at `tick` against the page's
   * prediction of that tick. Null when the page did not predict that tick.
   */
  check(tick: number, serverHash: string): CanaryResult {
    const mine = this.hashes.find((h) => h.tick === tick);
    if (!mine || !serverHash) return null;
    const ok = mine.hash === serverHash;
    if (!ok) this.enabled = false;
    return { tick, ok, hash: mine.hash };
  }

  /** Forget predictions (a local optimistic change, or a gap in the moves the frames list). */
  forget(): void {
    this.hashes = [];
  }
}
