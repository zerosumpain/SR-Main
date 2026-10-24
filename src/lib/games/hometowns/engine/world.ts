// The World (spec §5.16): one per county, a pure function of (county seed,
// county month), so every town computes the same common shocks lazily and
// independently. G(m) is a slow business cycle plus smoothed seeded noise;
// sectors drift within each season; tourism follows the cycle 15 months late;
// the base interest rate tracks G. The events deck is drawn from stream
// `world` as a function of (seed, block of days): at most one event at a time,
// roughly every five days, each announced at the Regional Day before it starts.

import { EVENTS } from './content';
import { TWO_PI, clamp, sinFx } from './fx';
import type { Params } from './params';
import { STREAMS, h32, normal } from './rand';
import type { WorldAt, WorldEventState } from './types';

export interface SeasonInfo {
  startMonth: number;
  boomBust: boolean;
}

/** County months per real day (the Regional Day falls once every 48 ticks = 12 months). */
const MONTHS_PER_DAY = 12;

/** G(m) = 1 + A·sin(2πm/period) + e(m), e(m) = Σ_j ar^j · σ · n(seed, m − j). */
export function cycleG(seed: number, m: number, p: Params, boomBust: boolean): number {
  const w = p.world;
  const amp = boomBust ? w.ampBoomBust : w.amp;
  let e = 0;
  let decay = 1;
  for (let j = 0; j < w.noiseMonths; j++) {
    e += decay * w.sigma * normal(seed, 'world', 1, m - j, 0);
    decay *= w.ar;
  }
  return 1 + amp * sinFx((TWO_PI * m) / w.period) + e;
}

/** The event (if any) active in county month m. */
export function eventAt(seed: number, m: number, p: Params): WorldEventState | null {
  const every = p.world.eventEveryDays;
  const day = Math.floor(m / MONTHS_PER_DAY);
  const block = Math.floor(day / every);
  // An event may still be running from the previous block (it can last into the next one).
  for (const b of [block - 1, block]) {
    const ev = eventInBlock(seed, b, p);
    if (ev && m >= ev.fromMonth && m < ev.toMonth) return ev;
  }
  return null;
}

/** Each block of `eventEveryDays` days holds exactly one event, starting on a seeded day of the block. */
export function eventInBlock(seed: number, block: number, p: Params): WorldEventState | null {
  if (block < 0) return null;
  const every = p.world.eventEveryDays;
  const h = h32(seed, STREAMS.world, 2, block, 0);
  const startDay = block * every + 1 + (h % Math.max(1, every - 2));
  const [lo, hi] = p.world.eventMonths;
  const len = lo + (h32(seed, STREAMS.world, 3, block, 0) % (hi - lo + 1));
  // Calendar-bound events (Cosy Winter) are never drawn here: the deck below skips them, since a
  // pure function of (seed, month) cannot know the real calendar. calendarEvent() adds Cosy Winter
  // from the tick's own real instant instead.
  const deck = EVENTS.filter((e) => e.realMonth === undefined);
  const id = deck[h32(seed, STREAMS.world, 4, block, 0) % deck.length].id;
  const fromMonth = startDay * MONTHS_PER_DAY;
  return { id, fromMonth, toMonth: fromMonth + len };
}

/** World(m) for every town of the county. */
export function worldAt(seed: number, m: number, season: SeasonInfo, p: Params): WorldAt {
  const w = p.world;
  const G = cycleG(seed, m, p, season.boomBust);
  const span = w.seasonMonths;
  const into = (((m - season.startMonth) % span) + span) % span;
  const s = into / span;
  const event = eventAt(seed, m, p);
  let goods = G * (1 - w.seasonTrend * s);
  let office = G * (1 + w.seasonTrend * s);
  let tourism = 1 + 0.5 * (cycleG(seed, m - w.tourismLag, p, season.boomBust) - 1);
  if (event?.id === 'factoryBoom') goods *= 1.2;
  if (event?.id === 'techFair') office *= 1.2;
  if (event?.id === 'rainySpell') tourism *= 0.85;
  if (event?.id === 'festivalSeason') tourism *= 1.15;
  return {
    month: m,
    G,
    goods,
    office,
    tourism,
    people: 1 + 0.5 * (G - 1),
    rBase: clamp(w.rBase + w.rSlope * (G - 1), w.rBand[0], w.rBand[1]),
    seasonProgress: s,
    event,
  };
}

/** "Economists forecast a slowdown": G falls below the threshold within 24 months of m. */
export function slowdownAhead(seed: number, m: number, season: SeasonInfo, p: Params): boolean {
  for (let k = 1; k <= 24; k++) if (cycleG(seed, m + k, p, season.boomBust) < p.world.slowdownAt) return true;
  return false;
}

/**
 * §5.16's calendar-bound event: Cosy Winter runs in the real December (London
 * time) whenever no drawn event is active. The deck cannot hold it, because
 * World(m) is a pure function of the county month and a pause moves the
 * calendar against it; the tick's real instant is in its context, so this is
 * still deterministic, and the Regional Day before a December can announce it.
 */
export function calendarEvent(event: WorldEventState | null, calendarMonth: number): WorldEventState | null {
  if (event) return event;
  const def = EVENTS.find((e) => e.realMonth !== undefined && e.realMonth === calendarMonth);
  return def ? { id: def.id, fromMonth: -1, toMonth: -1 } : null;
}
