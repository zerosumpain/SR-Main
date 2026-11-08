// The County Goals board (WP3, spec §8.7 item 9): each County Week, 8 shared
// tasks drawn from templates and scaled to the county (archived towns do not
// count toward the scaling, A33). Everyone works on them together; failure
// costs nothing. Four done earns a Festival Weekend (a day of more tourism
// everywhere), six a decoration set for every town, all eight a County
// statue. Progress is measured from the week's samples at Sunday's Regional
// Day, so a goal is never met by one lucky snapshot.

import { population } from './core';
import { buildingIndex } from './content';
import { powFx } from './fx';
import { h32, STREAMS } from './rand';
import { isActive, regionOf, rp } from './region-state';
import { B_KIND } from './tiles';
import type { CountyState, GoalsBoard, TownState, WeekTown } from './types';

const PARKS = ['villageGreen', 'pocketPark', 'park'].map(buildingIndex).filter((k) => k >= 0);

function hasPark(t: TownState): boolean {
  return t.buildings.some((b) => PARKS.includes(b[B_KIND]));
}

function unemploymentRate(t: TownState): number {
  const m = t.peopleMemo;
  if (!m) return 0;
  let u = 0;
  let jobs = 0;
  for (let h = 0; h < 3; h++) {
    u += m.unemployed[h] ?? 0;
    jobs += m.jobs[h] ?? 0;
  }
  return u + jobs > 0 ? u / (u + jobs) : 0;
}

interface Template {
  key: string;
  /** The target for a county of `n` active towns and scale `s` (§8.8's stage scaling, reused). */
  target: (n: number, s: number) => number;
  /** Progress over the week just ended. */
  progress: (c: CountyState) => number;
}

const active = (c: CountyState) => c.towns.filter(isActive);

export const GOAL_TEMPLATES: readonly Template[] = [
  { key: 'visitors', target: (_n, s) => Math.round(5000 * s), progress: (c) => sumWeek(c, (w) => w.visitors) },
  { key: 'gifts', target: (n) => Math.max(2, n + 1), progress: (c) => sumWeek(c, (w) => w.kind) },
  { key: 'parks', target: (n) => n, progress: (c) => active(c).filter(hasPark).length },
  { key: 'jobsForAll', target: (n) => n, progress: (c) => active(c).filter((t) => unemploymentRate(t) < 0.06).length },
  { key: 'links', target: (n) => Math.max(1, n - 1), progress: (c) => c.links.filter((l) => l.state === 'open' || l.state === 'closing').length },
  { key: 'cheerful', target: (n) => n, progress: (c) => active(c).filter((t) => (t.civicMemo?.mood ?? 0) >= 60).length },
  { key: 'grow', target: (_n, s) => Math.round(300 * s), progress: (c) => sumWeek(c, (w) => w.pop1 - w.pop0) },
  { key: 'culture', target: (n) => 5 * n, progress: (c) => Math.round(sumWeek(c, (w) => w.culture1 - w.culture0)) },
  { key: 'goodsTrade', target: (n) => Math.max(1, n - 1), progress: (c) => c.allocations.length },
  { key: 'busy', target: (n) => n, progress: (c) => active(c).filter((t) => t.tier >= 1).length },
];

function sumWeek(c: CountyState, f: (w: WeekTown) => number): number {
  const g = regionOf(c);
  let s = 0;
  for (let i = 0; i < c.towns.length; i++) if (isActive(c.towns[i]) && g.week[i]) s += f(g.week[i]);
  return s;
}

/** max(0.5, (ΣN/20,000)^0.7) over active towns (§8.8). */
export function countyScale(c: CountyState): number {
  let N = 0;
  for (const t of c.towns) if (isActive(t)) N += population(t);
  return Math.max(0.5, powFx(N / 20000, 0.7));
}

/** A fresh board for `week`: `count` templates by a seeded shuffle, targets scaled to the county. */
export function newBoard(c: CountyState, week: number): GoalsBoard {
  const n = Math.max(1, active(c).length);
  const s = countyScale(c);
  const idx = GOAL_TEMPLATES.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = h32(c.seed, STREAMS.gazette, week, i, 2) % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const goals = idx.slice(0, rp(c).goals).map((k) => ({ key: GOAL_TEMPLATES[k].key, target: Math.max(1, GOAL_TEMPLATES[k].target(n, s)), progress: 0 }));
  return { week, goals };
}

/** Scores the board on Sunday: each goal's progress over the week. Returns how many are done. */
export function scoreBoard(c: CountyState): number {
  let done = 0;
  for (const goal of c.goals.goals) {
    const tpl = GOAL_TEMPLATES.find((t) => t.key === goal.key);
    if (!tpl) continue;
    goal.progress = Math.max(0, tpl.progress(c));
    if (goal.progress >= goal.target) done++;
  }
  return done;
}

/** The reward for `done` goals: 'festivalWeekend', 'decorations', 'statue', or null. */
export function rewardFor(c: CountyState, done: number): string | null {
  const [a, b, d] = rp(c).goalRewards;
  if (done >= d) return 'statue';
  if (done >= b) return 'decorations';
  if (done >= a) return 'festivalWeekend';
  return null;
}
