// Off-rule identity runs (spec §11.3, §10.4 item 7): with an optional system
// switched off, every OTHER system must be bit-identical until it consumes
// the switched-off system's output. The runner plays the same county twice,
// once as shipped and once with the system off, and records a trace: the
// town's state hash after every tick and after every month step, in
// execution order. Two runs are identical up to the first trace entry that
// differs; that entry must be one of the system's own steps. A divergence
// that shows first anywhere else means switching the system off shifted
// something it should not touch (a shared RNG draw, a hidden module global,
// a slot read before it was written).

import { STEPS, withSteps } from '../../../src/lib/games/hometowns/engine/steps';
import * as stubs from '../../../src/lib/games/hometowns/engine/stubs';
import { fnv64 } from '../../../src/lib/games/hometowns/engine/hash';
import { commitTown } from '../../../src/lib/games/hometowns/engine/core';
import { SLOT_NAMES } from '../../../src/lib/games/hometowns/engine/derived';
import type { MonthContext, StepTable, TickContext, TownState } from '../../../src/lib/games/hometowns/engine/types';
import { runCounty, type CountySpec } from './run';
import type { OffRuleRow } from './summary';

export interface OptionalSystem {
  id: string;
  /** Step overrides that switch it off (its stubs), or null if it has no switch yet. */
  off: Record<string, unknown> | null;
  /** The step ids that belong to it: the only places a divergence may start. */
  own: string[];
  note?: string;
}

/** The optional systems of §10.4 item 7. Only tourism has a step at M0; the rest arrive with WP3 or need a rules flag. */
export const OPTIONAL_SYSTEMS: OptionalSystem[] = [
  { id: 'tourism', off: { 'M6 tourism': stubs.stubTourism }, own: ['M6 tourism'] },
  { id: 'events', off: null, own: [], note: 'World events are drawn inside worldAt; switching them off needs a params rules flag (WP1/WP3)' },
  { id: 'shared air', off: null, own: [], note: 'Spirited shared air arrives with WP3 (DayFlows.airIn)' },
  { id: 'pranks', off: null, own: [], note: 'pranks are WP3 moves' },
];

const hashTown = (t: TownState) => {
  commitTown(t);
  return fnv64(JSON.stringify(t));
};

/** Typed arrays as plain arrays, so a blackboard slot hashes by content. */
const plain = (_k: string, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v);

/** A step table that appends [label, hash of the town and of the slots the step wrote] after every tick and every month step. */
function traced(base: StepTable, trace: string[]): StepTable {
  const month = base.month.map((s) => ({
    ...s,
    run: (t: TownState, m: MonthContext) => {
      const before = SLOT_NAMES.map((n) => m.derived[n]);
      s.run(t, m);
      const wrote = SLOT_NAMES.filter((n, k) => m.derived[n] !== before[k]).map((n) => [n, m.derived[n]]);
      trace.push(`town ${m.townIndex} month ${m.month} ${s.id}=${hashTown(t)}:${fnv64(JSON.stringify(wrote, plain))}`);
    },
  }));
  const last = base.tick.length - 1;
  const tick = base.tick.map((s, k) =>
    k === last
      ? {
          ...s,
          run: (t: TownState, ctx: TickContext) => {
            s.run(t, ctx);
            trace.push(`town ${ctx.townIndex} tick ${ctx.tick} tick=${hashTown(t)}`);
          },
        }
      : s,
  );
  return { tick, month, regional: base.regional };
}

/** The step id of a trace entry ('tick' for tick entries). */
const stepOf = (entry: string) => {
  const m = /^town \d+ (?:month \d+ (.+)|tick \d+ tick)=/.exec(entry);
  return m ? (m[1] ?? 'tick') : '?';
};

export interface OffRuleScenario {
  seed: number;
  bots: string[];
  days: number;
}

export const DEFAULT_SCENARIO: OffRuleScenario = { seed: 5, bots: ['tourist', 'balanced'], days: 3 };

/** Runs one system's identity check. */
export function offRuleCheck(sys: OptionalSystem, sc: OffRuleScenario = DEFAULT_SCENARIO): OffRuleRow {
  if (!sys.off) return { system: sys.id, status: 'pending', firstDivergence: null, note: sys.note ?? 'no switch yet' };
  const run = (steps: StepTable) => {
    const trace: string[] = [];
    const spec: CountySpec = { experiment: 'offrule', seed: sc.seed, bots: sc.bots, days: sc.days, observe: false, steps: traced(steps, trace) };
    runCounty(spec);
    return trace;
  };
  const a = run(STEPS);
  const b = run(withSteps(sys.off as Parameters<typeof withSteps>[0]));
  const n = Math.min(a.length, b.length);
  let k = 0;
  while (k < n && a[k] === b[k]) k++;
  if (k === n && a.length === b.length) return { system: sys.id, status: 'identical', firstDivergence: null, note: `${a.length} trace entries identical: the system had no effect in this scenario` };
  const entry = (k < a.length ? a[k] : b[k]).replace(/=.*$/, '');
  const step = stepOf(k < a.length ? a[k] : b[k]);
  const ok = sys.own.includes(step);
  return {
    system: sys.id,
    status: ok ? 'pass' : 'fail',
    firstDivergence: entry,
    note: ok ? `identical for ${k} entries, then first differs in its own step` : `first differs in ${step}, which is not part of ${sys.id}: switching it off leaks`,
  };
}

export function offRuleReport(systems = OPTIONAL_SYSTEMS, sc: OffRuleScenario = DEFAULT_SCENARIO): OffRuleRow[] {
  return systems.map((s) => offRuleCheck(s, sc));
}
