// The `derived` block of the wire (stars, meters, wants, advisors, needs,
// the pipeline, Town Talk) for harness mode, where there is no server to send
// it. Like the server adapter, it runs one month step on a throwaway copy of
// the town with an extra step at the end that keeps the blackboard (derived
// state is never stored, §10.2), and shapes it the way MeWire['derived'] is
// shaped, so harness mode and the app draw from the same block.

import {
  ADVISOR_RULES,
  NEED_ITEMS,
  STEPS,
  ladder,
  makeContext,
  monthStep,
  type AdvisorCard,
  type CountyState,
  type DerivedCache,
  type StepTable,
  type TownState,
  type Want,
} from '../engine';
import type { Derived } from '../layers';

/** The month step's blackboard for town i as of now (null if the month would not run). */
export function probe(c: CountyState, i: number): DerivedCache | null {
  const copy = JSON.parse(JSON.stringify(c.towns[i])) as TownState;
  let got: DerivedCache | null = null;
  const keep = { id: 'WP6 harness probe', owner: 'WP6' as const, writes: [], run: (_t: TownState, m: { derived: DerivedCache }) => void (got = m.derived) };
  const steps: StepTable = { tick: STEPS.tick, month: [...STEPS.month, keep], regional: STEPS.regional };
  try {
    monthStep(copy, makeContext(c, i, copy.tick), steps);
  } catch {
    return null;
  }
  return got;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const sum = (xs: readonly number[] | undefined): number => (xs ?? []).reduce((a, b) => a + b, 0);

/** MeWire['derived'] for town i, from a probe. */
export function derivedOf(c: CountyState, i: number): Derived {
  const t = c.towns[i];
  const d = probe(c, i);
  const memo = t.civicMemo;
  const mood = d?.mood ?? null;
  const reach = d?.housing?.reachable ?? d?.development?.reachableHomes ?? null;
  const homesTier = t.meters.slice(0, 3).indexOf(Math.max(...t.meters.slice(0, 3)));
  const wants: Want[] = (mood?.wants ?? memo?.wants ?? []).map((w) => ({
    key: w.key,
    severity: Math.round(w.severity),
    tile: -1,
    hatched: w.key === 'homes' && !!reach && reach[homesTier] === false,
  }));
  const advisors: AdvisorCard[] = (mood?.advisors ?? memo?.advisors ?? []).map((id) => {
    const rule = ADVISOR_RULES.find((r) => r.id === id);
    const data: Record<string, string> = rule ? { action: rule.action } : {};
    return { advisor: rule?.advisor ?? (id.split('.')[0] as AdvisorCard['advisor']), key: id, data };
  });
  const needs = d?.needs
    ? [0, 1, 2].map((h) => ({
        cohort: h * 3 + 1,
        tier: h,
        items: ladder(h).map((k, j) => ({ key: NEED_ITEMS[k].id, met: r2(d.needs!.items[h]?.[j] ?? 0), buildable: NEED_ITEMS[k].unlock <= t.tier })),
      }))
    : [];
  return {
    stars: t.perceived.map(r1),
    meters: t.meters.map(r1),
    wants,
    advisors,
    needs,
    pipeline: { homes: Math.round(sum(d?.development?.pipeline)), movers: Math.round(sum(t.applicants)) },
    townTalk: (mood?.townTalk ?? memo?.talk ?? []).map(([k, v]) => [k, v] as [string, number]),
  };
}
