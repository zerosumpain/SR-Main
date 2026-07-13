import { describe, it, expect } from 'vitest';
import { JOIN_QUERIES, joinQueryById, runJoinQuery, buildJoinScenario } from './joins';
import { buildTopology, holderById, SUPPLIERS } from './topology';
import type { SimAction } from './engine';

const topo = buildTopology({ schoolCount: 2000 });

function nodeRefs(a: SimAction): string[] {
  switch (a.kind) {
    case 'pulse': return [a.from, a.to];
    case 'fanout': return [a.supplier];
    case 'flash': return [a.node];
    case 'highlight': return a.nodes;
    default: return [];
  }
}

describe('the cross-context join catalogue', () => {
  it('offers the hard joins plus a single-context baseline', () => {
    expect(JOIN_QUERIES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(JOIN_QUERIES.map((q) => q.id)).size).toBe(JOIN_QUERIES.length);
    expect(JOIN_QUERIES.some((q) => q.singleContext)).toBe(true);       // the easy contrast
    expect(JOIN_QUERIES.some((q) => q.horizon === 'future')).toBe(true); // the frontier
    for (const q of JOIN_QUERIES) {
      expect(q.queryBody).toContain('SELECT');
      expect(q.question.length).toBeGreaterThan(10);
      expect(q.returnNotes.length).toBeGreaterThan(0);
      expect(q.hardBecause.length).toBeGreaterThan(0);
      // every counterpart resolves to a real second-world holder
      for (const c of q.counterparts) expect(holderById(c), `unknown holder ${c}`).toBeDefined();
    }
  });

  it('joinQueryById resolves', () => {
    expect(joinQueryById('absence-cin')?.id).toBe('absence-cin');
    expect(joinQueryById('nope')).toBeUndefined();
  });

  it('names both schools and local authorities across the set', () => {
    const laJoins = JOIN_QUERIES.filter((q) => q.counterparts.some((c) => c.startsWith('la-')));
    expect(laJoins.length).toBeGreaterThanOrEqual(4); // the core schools × LA joins
  });
});

describe('runJoinQuery', () => {
  const hardJoin = JOIN_QUERIES.find((q) => !q.singleContext && q.matchDifficulty === 'hard')!;
  const baseline = JOIN_QUERIES.find((q) => q.singleContext)!;

  it('is deterministic', () => {
    expect(runJoinQuery(hardJoin)).toEqual(runJoinQuery(hardJoin));
  });

  it('computes a partial for every MIS estate and every counterpart holder', () => {
    const run = runJoinQuery(hardJoin);
    expect(run.schoolPartials).toHaveLength(SUPPLIERS.length);
    expect(run.otherPartials).toHaveLength(hardJoin.counterparts.length);
    for (const p of run.otherPartials) expect(holderById(p.holderId)).toBeDefined();
  });

  it('resolves honestly: matched + unmatched = candidate pairs, and the answer is the matched count', () => {
    const run = runJoinQuery(hardJoin);
    const r = run.resolution;
    expect(r.matched + r.unmatched).toBe(r.candidatePairs);
    expect(r.unmatched).toBeGreaterThan(0);              // a real join always loses some links
    expect(run.assembled.answerValue).toBe(r.matched);
    expect(r.matchRate).toBeLessThan(1);                 // never a clean join
    expect(r.confidence).toMatch(/HIGH|MEDIUM|LOW/);
    expect(run.assembled.caveats.length).toBeGreaterThanOrEqual(2);
  });

  it('the single-context baseline needs no resolver: 100% coverage, nothing unmatched', () => {
    const run = runJoinQuery(baseline);
    expect(run.otherPartials).toHaveLength(0);
    expect(run.resolution.unmatched).toBe(0);
    expect(run.resolution.matchRate).toBe(1);
    expect(run.assembled.coveragePct).toBe(100);
    expect(run.assembled.answerValue).toBeGreaterThan(0);
  });
});

describe('buildJoinScenario', () => {
  it('produces an engine-playable scenario over real topology nodes', () => {
    for (const q of JOIN_QUERIES) {
      const scenario = buildJoinScenario(runJoinQuery(q));
      expect(scenario.id).toBe(`join-${q.id}`);
      expect(scenario.group).toBe('Joining two worlds');
      expect(scenario.steps.length).toBeGreaterThanOrEqual(3);
      for (const step of scenario.steps) {
        expect(step.narration.length).toBeGreaterThan(20);
        expect(step.holdMs).toBeGreaterThanOrEqual(1000);
        for (const a of step.actions) {
          for (const ref of nodeRefs(a)) {
            expect(topo.byId.has(ref), `${q.id}: unknown node "${ref}"`).toBe(true);
          }
        }
      }
    }
  });

  it('a real join routes candidate keys through the resolver; the baseline does not', () => {
    const hard = buildJoinScenario(runJoinQuery(JOIN_QUERIES.find((q) => !q.singleContext)!));
    const hardActions = hard.steps.flatMap((s) => s.actions);
    expect(hardActions.some((a) => nodeRefs(a).includes('resolver'))).toBe(true);

    const base = buildJoinScenario(runJoinQuery(JOIN_QUERIES.find((q) => q.singleContext)!));
    const baseActions = base.steps.flatMap((s) => s.actions);
    expect(baseActions.some((a) => nodeRefs(a).includes('resolver'))).toBe(false);
  });
});
