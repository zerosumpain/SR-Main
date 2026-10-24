// Harness mode's in-page county (spec §9.16): a solo county run entirely in
// the page, with no server, no authentication and no network. A person plays
// it exactly as a phone would — every move goes through the engine's
// `applyCommand` — on a local clock with a dev speed.
//
// The clock is virtual. "Live" is the local preview's dev clock (§2.6:
// devTickMs = 30 s, a Regional Day every 48 ticks), and the faster speeds
// run more game weeks per real second. The county is saved in this browser
// (a per-viewer convenience: a private window starts afresh), and on reopen
// it catches up by the real time that passed at the Live rate, so the town
// grows while you are away and welcome back has something to say.

import {
  ENGINE_HASH,
  EngineError,
  TICKS_PER_YEAR,
  applyCommand,
  catchUp,
  createCounty,
  gridEndAt,
  nextRegionalDayAt,
  paramsFor,
  population,
  stateHash,
  type Command,
  type CommandResult,
  type CountyState,
  type FoundBody,
  type TownState,
} from '../engine';
import { botTurn } from './bot';

/** Tuesday 20 October 2026, 12:00 UTC: the harness county's epoch (any fixed instant would do). */
export const HARNESS_EPOCH = 1792497600000;
export const HARNESS_SEAT = 'harness-mayor';
export const DEV_TICK_MS = 30_000;
/** Ticks per real second: Pause, Live (the dev clock), then faster. */
export const SPEEDS = [0, 1 / 30, 1, 4, 16, 48] as const;
export const SPEED_LABELS = ['Pause', 'Live', '1 wk/s', '4 wk/s', '16 wk/s', '48 wk/s'];
/** Catch-up work units per chunk (the server's §10.5 chunk size). */
const CHUNK_UNITS = 96;
/** A hello at least this often (virtual time) keeps the county from napping (A21). */
const HELLO_EVERY_MS = 12 * 3_600_000;
/** On reopen, at most this much missed time is caught up (the county naps after 72 h anyway). */
const AWAY_CAP_MS = 72 * 3_600_000;

export interface LocalOptions {
  seed?: number;
  /** Load and save in this browser under this key (null: never). */
  storageKey?: string | null;
  /** Real clock (tests pass their own). */
  realNow?: () => number;
}

export interface Outcome {
  ok: boolean;
  result?: CommandResult;
  error?: string;
}

interface Saved {
  v: 1;
  /** The engine that wrote it: a county from another engine is not reloaded (its shape may differ). */
  engine: string;
  county: CountyState;
  now: number;
  savedAt: number;
  speed: number;
}

function load(key: string | null): Saved | null {
  if (!key) return null;
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    // Once the engine changes (a new release, the tuning branch) a saved county starts afresh rather than failing to start.
    return s && s.v === 1 && s.engine === ENGINE_HASH && s.county && Number.isFinite(s.now) ? s : null;
  } catch {
    return null;
  }
}

export class LocalCounty {
  county: CountyState;
  /** The virtual instant the county has been driven to. */
  now: number;
  /** Ticks per real second (one of SPEEDS). */
  speed: number = SPEEDS[1];
  readonly seed: number;
  /** True when this county came back from storage (welcome back may have something to say). */
  readonly restored: boolean;
  /** Real ms the county was away before this load (0 for a new one). */
  readonly awayMs: number;
  private key: string | null;
  private readonly realNow: () => number;
  private lastSave = 0;
  private serial = 0;
  /** The virtual instant the Live/fast clock wants to reach; catch-up runs toward it in chunks. */
  private target: number;

  constructor(o: LocalOptions = {}) {
    this.seed = (o.seed ?? 1) >>> 0;
    this.key = o.storageKey === undefined ? null : o.storageKey;
    this.realNow = o.realNow ?? (() => Date.now());
    const saved = load(this.key);
    if (saved && saved.county.seed === this.seed) {
      this.county = saved.county;
      this.now = saved.now;
      this.speed = (SPEEDS as readonly number[]).includes(saved.speed) ? saved.speed : SPEEDS[1];
      this.restored = true;
      this.awayMs = Math.max(0, this.realNow() - saved.savedAt);
      // Time away runs at the Live rate (the dev clock), capped: the county would nap past 72 h.
      this.target = this.now + Math.min(AWAY_CAP_MS, this.awayMs);
    } else {
      this.county = createCounty({
        seed: this.seed,
        params: 'v1',
        settings: { rivalry: 'friendly', mishaps: 'mild', youngestOrder: [], perSeat: {} },
        epoch: HARNESS_EPOCH,
        now: HARNESS_EPOCH,
        devTickMs: DEV_TICK_MS,
      });
      this.now = HARNESS_EPOCH + 1000;
      this.restored = false;
      this.awayMs = 0;
      this.target = this.now;
    }
  }

  /** The town this page plays: the harness mayor's, or any town of a county loaded with `load`. */
  townIndex = 0;
  seat = HARNESS_SEAT;

  get town(): TownState | null {
    return this.county.towns[this.townIndex] ?? null;
  }

  /** Shows another county (Playwright's fixture towns): it is not saved, and the clock starts paused. */
  load(c: CountyState, townIndex: number, now: number): void {
    this.county = c;
    this.townIndex = townIndex;
    this.seat = c.towns[townIndex]?.seat ?? HARNESS_SEAT;
    this.now = now;
    this.target = now;
    this.speed = 0;
    this.key = null;
  }

  get params() {
    return paramsFor(this.county.paramsVersion);
  }

  /** In the Founding Fortnight: the town ticks only when the mayor taps "Next week ▶" (§2.3). */
  get inFortnight(): boolean {
    const t = this.town;
    return !!t && t.gridBase === null && t.sprintLeft > 0;
  }

  /** True while time away is still being caught up. */
  get catchingUp(): boolean {
    return this.now < this.target - 1;
  }

  newMoveId(kind: string): string {
    this.serial += 1;
    return `${kind}-${this.realNow().toString(36)}-${this.serial}`;
  }

  /** Any move, as a phone would post it. A Regional Day that is due runs first (the store's retry, A19). */
  act(cmd: Command): Outcome {
    try {
      let result: CommandResult;
      try {
        result = applyCommand(this.county, this.seat, cmd, this.now);
      } catch (e) {
        if (!(e instanceof EngineError) || !e.retry) throw e;
        catchUp(this.county, this.now, 1_000_000);
        result = applyCommand(this.county, this.seat, cmd, this.now);
      }
      this.save(false);
      return { ok: true, result };
    } catch (e) {
      if (e instanceof EngineError) return { ok: false, error: e.message };
      throw e;
    }
  }

  found(body: FoundBody): Outcome {
    return this.act({ type: 'found', ...body });
  }

  /**
   * One Founding Fortnight sprint (§2.3). The virtual clock steps over the
   * 10-second gap between taps, so a harness player never waits.
   */
  sprint(): Outcome {
    const t = this.town;
    if (!t) return { ok: false, error: 'Found your town first.' };
    const gap = this.params.clock.sprintMinGapMs;
    if (t.sprintAt !== 0 && this.now - t.sprintAt < gap) this.jump(t.sprintAt + gap - this.now);
    return this.act({ type: 'sprint', moveId: this.newMoveId('sprint') });
  }

  /** "Play it all": every remaining sprint now. */
  sprintAll(): number {
    let n = 0;
    while (this.inFortnight && n < 16) {
      if (!this.sprint().ok) break;
      n++;
    }
    return n;
  }

  /** Moves the virtual clock on by `ms` at once (and the catch-up target with it). */
  jump(ms: number): void {
    this.now += ms;
    this.target = Math.max(this.target, this.now);
  }

  /**
   * Advances the clock by `realMs` of wall time at the current speed, then
   * runs catch-up toward it in chunks until `budgetMs` of work is spent.
   * Returns the ticks the town ran.
   */
  advance(realMs: number, budgetMs: number, clock: () => number): number {
    const t = this.town;
    const before = t?.tick ?? 0;
    if (this.speed > 0) this.target += realMs * this.speed * this.county.tickMs / 1000;
    if (this.target <= this.now) return 0;
    const start = clock();
    if (this.autopilot) this.autopilotSprints(realMs);
    while (this.now < this.target && clock() - start < budgetMs) {
      // Whole grid ticks only: the next boundary, or the target if it comes first.
      const next = Math.min(this.target, gridEndAt(this.county, this.county.gridTick));
      this.now = Math.max(this.now, next);
      this.keepAwake();
      let r = catchUp(this.county, this.now, CHUNK_UNITS);
      while (!r.done && clock() - start < budgetMs) r = catchUp(this.county, this.now, CHUNK_UNITS);
      if (!r.done) break;
      if (this.autopilot) this.autopilotTurn();
    }
    this.save(false);
    return (this.town?.tick ?? 0) - before;
  }

  /** A hello now and then, so the county does not fall asleep while you play (A21). */
  private keepAwake(): void {
    if (this.now - this.county.lastHelloAt < HELLO_EVERY_MS) return;
    try {
      applyCommand(this.county, this.seat, { type: 'hello' }, this.now);
    } catch {
      // A hello before founding has no town to greet; the county clock still counts it.
    }
  }

  /** Whole game days (48 ticks each on the dev clock), without the frame loop: Playwright and tests. */
  runDays(days: number, bot = false): void {
    const t = this.town;
    if (!t) return;
    if (this.inFortnight) bot ? this.botSprints() : this.sprintAll();
    const end = (this.town?.tick ?? 0) + days * TICKS_PER_YEAR;
    let lastMonth = -1;
    while ((this.town?.tick ?? end) < end) {
      this.now = gridEndAt(this.county, this.county.gridTick);
      this.target = Math.max(this.target, this.now);
      this.keepAwake();
      catchUp(this.county, this.now, 1_000_000);
      const month = Math.floor((this.town?.tick ?? 0) / 4);
      if (bot && month !== lastMonth) {
        lastMonth = month;
        this.botTurn();
      }
    }
    this.save(true);
  }

  /**
   * ?bot=1: the harness bot plays. It founds the town, taps through the
   * fortnight at the clock's speed, and takes a turn after every month step.
   */
  autopilot = false;
  private sprintCredit = 0;
  private lastBotMonth = -1;

  private autopilotSprints(realMs: number): void {
    if (!this.town) {
      this.found({ site: 0, nameParts: ['Bramble', 'ford'], avatar: 'badger', flag: 0 });
      this.botTurn();
    }
    if (!this.inFortnight) return;
    this.sprintCredit += (realMs * this.speed) / 1000;
    while (this.sprintCredit >= 1 && this.inFortnight) {
      this.sprintCredit -= 1;
      if (!this.sprint().ok) break;
      this.autopilotTurn();
    }
  }

  private autopilotTurn(): void {
    const month = Math.floor((this.town?.tick ?? 0) / 4);
    if (month === this.lastBotMonth) return;
    this.lastBotMonth = month;
    this.botTurn();
  }

  /** The harness bot's turn. */
  botTurn(): void {
    let turn = botTurn(this.county, HARNESS_SEAT, this.now);
    if (turn.retry) {
      catchUp(this.county, this.now, 1_000_000);
      turn = botTurn(this.county, HARNESS_SEAT, this.now);
    }
  }

  private botSprints(): void {
    while (this.inFortnight) {
      this.botTurn();
      if (!this.sprint().ok) break;
    }
    this.botTurn();
  }

  /** Game ticks until the next Regional Day, whatever the speed (what a forecast's "exact until" is measured in). */
  ticksToRegionalDay(): number {
    const R = nextRegionalDayAt(this.county, this.params.clock.devRegionalTicks);
    return Math.max(0, (R - this.now) / this.county.tickMs);
  }

  /** Real ms until the next Regional Day at the current speed (Infinity when paused). */
  msToRegionalDay(): number {
    const R = nextRegionalDayAt(this.county, this.params.clock.devRegionalTicks);
    if (this.speed <= 0) return Infinity;
    return ((R - this.now) / this.county.tickMs / this.speed) * 1000;
  }

  hash(): string {
    return this.town ? stateHash(this.town) : '';
  }

  population(): number {
    return this.town ? population(this.town) : 0;
  }

  /** Saves at most every few seconds unless forced (and never without a storage key). */
  save(force: boolean): void {
    if (!this.key) return;
    const real = this.realNow();
    if (!force && real - this.lastSave < 5000) return;
    this.lastSave = real;
    try {
      const s: Saved = { v: 1, engine: ENGINE_HASH, county: this.county, now: this.now, savedAt: real, speed: this.speed };
      globalThis.localStorage?.setItem(this.key, JSON.stringify(s));
    } catch {
      // A full or blocked store: the county simply is not kept for next time.
    }
  }

  /**
   * Forgets the saved county (a fresh start), and saves nothing more from
   * this page: the reload that follows fires `beforeunload`, which would
   * otherwise write this county straight back.
   */
  forget(): void {
    if (!this.key) return;
    try {
      globalThis.localStorage?.removeItem(this.key);
    } catch {
      // See save.
    }
    this.key = null;
  }
}
