// Harness mode's in-page county (spec §9.16): a one-town county run entirely
// in the page, on a virtual clock, with the Lab's Balanced bot as its mayor. No
// server, no authentication and no network.
//
// Time is virtual and advances in whole grid ticks, so a seed always plays
// the same town whatever the frame rate: the page decides only how many
// ticks to run per frame. The county uses the dev clock (§2.6:
// devTickMs = 30 s, a Regional Day every 48 ticks), which is what the local
// preview's server counties use too.

import {
  EngineError,
  applyCommand,
  catchUp,
  createCounty,
  gridEndAt,
  paramsFor,
  population,
  stateHash,
  type CountyState,
  type TownState,
} from '../engine';
import { botTurn, type BotTurn } from './bot';

/** Tuesday 20 October 2026, 12:00 UTC: the harness county's epoch (any fixed instant would do). */
export const HARNESS_EPOCH = 1792497600000;
export const HARNESS_SEAT = 'harness-mayor';
export const DEV_TICK_MS = 30_000;

export interface HarnessOptions {
  seed?: number;
  /** Site index 0–5 around Kingsport. */
  site?: number;
}

export interface HarnessEvent {
  tick: number;
  text: string;
}

export class HarnessSession {
  readonly county: CountyState;
  readonly seed: number;
  /** The virtual instant the county has been driven to. */
  now: number;
  /** The last few things the bot did or was refused (newest last). */
  readonly log: HarnessEvent[] = [];
  private lastMonth = -1;

  constructor(o: HarnessOptions = {}) {
    this.seed = (o.seed ?? 1) >>> 0;
    this.now = HARNESS_EPOCH;
    this.county = createCounty({
      seed: this.seed,
      params: 'v1',
      settings: { rivalry: 'friendly', mishaps: 'mild', youngestOrder: [], perSeat: {} },
      epoch: HARNESS_EPOCH,
      now: this.now,
      devTickMs: DEV_TICK_MS,
    });
    this.now += 1000;
    const site = o.site ?? 0;
    applyCommand(this.county, HARNESS_SEAT, { type: 'found', site, nameParts: ['Bramble', 'ford'], avatar: 'badger', flag: site }, this.now);
    this.note(botTurn(this.county, HARNESS_SEAT, this.now), 'founding');
  }

  get town(): TownState {
    return this.county.towns[0];
  }

  /** True while the Founding Fortnight's sprint ticks remain. */
  get inFortnight(): boolean {
    return this.town.gridBase === null && this.town.sprintLeft > 0;
  }

  /**
   * Runs one town tick: a sprint tap during the Founding Fortnight, then
   * one grid tick at a time. The bot takes a turn after every month step.
   */
  step(): void {
    const c = this.county;
    if (this.inFortnight) {
      this.now += paramsFor(c.paramsVersion).clock.sprintMinGapMs;
      applyCommand(c, HARNESS_SEAT, { type: 'sprint', moveId: `sprint-${this.town.tick}` }, this.now);
    } else {
      const target = gridEndAt(c, c.gridTick);
      if (target > this.now) this.now = target;
      // One tick of work (plus a Regional Day when one falls due) is far below this budget.
      catchUp(c, this.now, 1_000_000);
    }
    const month = Math.floor(this.town.tick / 4);
    if (month !== this.lastMonth) {
      this.lastMonth = month;
      let turn = botTurn(c, HARNESS_SEAT, this.now);
      if (turn.retry) {
        catchUp(c, this.now, 1_000_000);
        turn = botTurn(c, HARNESS_SEAT, this.now);
      }
      this.note(turn, `month ${month}`);
    }
  }

  /** Runs whole ticks until `n` have run or `budgetMs` of wall time has gone (the page's frame budget). */
  run(n: number, budgetMs = Infinity, clock: () => number = () => 0): number {
    const start = clock();
    let k = 0;
    while (k < n && clock() - start < budgetMs) {
      this.step();
      k++;
    }
    return k;
  }

  /** Runs whole game days (48 ticks each on the dev clock). */
  runDays(days: number): void {
    const end = this.town.tick + days * 48;
    while (this.town.tick < end) this.step();
  }

  stats(): HarnessStats {
    const t = this.town;
    return {
      name: t.name,
      tier: t.tier,
      tick: t.tick,
      day: this.county.dayIndex,
      month: Math.floor(t.tick / 4),
      population: population(t),
      reserves: t.money.reserves,
      meters: [...t.meters],
      approval: t.approval,
      happy: t.happy.length ? t.happy.reduce((a, b) => a + b, 0) / t.happy.length : 0,
      helper: t.money.helper !== null,
      alerts: t.alerts.length + this.county.alerts.length,
      buildings: t.buildings.length,
      fortnight: this.inFortnight,
    };
  }

  hash(): string {
    return stateHash(this.town);
  }

  private note(turn: BotTurn, when: string): void {
    const tick = this.town.tick;
    const plans = turn.moves.filter((m) => m !== 'hello');
    if (plans.length) this.push({ tick, text: `${when}: ${plans.length === 1 ? 'one move' : `${plans.length} moves`} (${plans.join(', ')})` });
    for (const r of turn.refused.slice(0, 2)) this.push({ tick, text: `${when}: refused: ${r}` });
  }

  private push(e: HarnessEvent): void {
    this.log.push(e);
    while (this.log.length > 30) this.log.shift();
  }
}

export interface HarnessStats {
  name: string;
  tier: number;
  tick: number;
  day: number;
  month: number;
  population: number;
  reserves: number;
  meters: number[];
  approval: number;
  happy: number;
  helper: boolean;
  alerts: number;
  buildings: number;
  fortnight: boolean;
}

export { EngineError };
