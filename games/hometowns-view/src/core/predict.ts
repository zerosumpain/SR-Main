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
/** Most ticks run in one advance call; fewer when the frame's simulation budget runs out first. */
const MAX_TICKS_PER_CALL = 8;
/**
 * A phone this many ticks behind (woken after a long sleep) does not run them
 * on the main thread, a month step every fourth: it waits for the server's
 * next frame, which the app asks for on waking, and draws what it has.
 */
export const MAX_BEHIND = 8;

export type CanaryResult = { tick: number; ok: boolean; hash: string } | null;

export class Predictor {
  /** False after a canary mismatch: the page then draws server state only. */
  enabled = true;
  private hashes: { tick: number; hash: string }[] = [];
  private nextAt = 0;
  private env: TownEnv | null = null;
  /** True while a local change the server has not confirmed is applied (the canary would be unfair). */
  dirty = false;
  /** Too far behind to catch up here: nothing runs until the next frame resets the town. */
  private waiting = false;

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
    this.waiting = false;
    // Predictions from the town this replaces, for ticks the new town has not
    // reached, were made from other inputs (a tax change from the app): the
    // canary must never compare the server against them.
    this.hashes = this.hashes.filter((h) => h.tick < town.tick);
  }

  /** The instant the next predicted tick is due, or null when none will run (paused, fortnight, day end). */
  nextDue(): number | null {
    if (!this.enabled || this.waiting || this.clock.paused || this.clock.napping || this.town.gridBase === null) return null;
    if (this.nextAt > this.clock.nextRegionalDayAt) return null;
    return this.nextAt;
  }

  /**
   * Runs the ticks whose boundary has passed by `now`, within `budgetMs` of
   * wall time (at least one; a month step alone can take longer). Returns
   * how many ran.
   */
  advance(now: number, budgetMs = Infinity): number {
    const first = this.nextDue();
    if (first !== null && now - first >= MAX_BEHIND * this.clock.tickMs) {
      this.waiting = true;
      return 0;
    }
    const started = performance.now();
    let n = 0;
    while (n < MAX_TICKS_PER_CALL && (n === 0 || performance.now() - started < budgetMs)) {
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
    // The newest prediction of that tick: an older one was made before a reset.
    let mine: { tick: number; hash: string } | undefined;
    for (let k = this.hashes.length - 1; k >= 0 && !mine; k--) if (this.hashes[k].tick === tick) mine = this.hashes[k];
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
