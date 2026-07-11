import { describe, it, expect } from 'vitest';
import { QUERIES, queryById, runQuery, buildQueryScenario } from './queries';
import { buildTopology, SUPPLIERS, EDTECH } from './topology';
import type { SimAction } from './engine';

const topo = buildTopology({ schoolCount: 1000 });

function nodeRefs(a: SimAction): string[] {
  switch (a.kind) {
    case 'pulse': return [a.from, a.to];
    case 'fanout': return [a.supplier];
    case 'flash': return [a.node];
    case 'highlight': return a.nodes;
    default: return [];
  }
}

describe('the question catalogue', () => {
  it('offers both statutory and voluntary questions with real query bodies', () => {
    expect(QUERIES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(QUERIES.map((q) => q.id)).size).toBe(QUERIES.length);
    expect(QUERIES.some((q) => q.basis === 'statutory')).toBe(true);
    expect(QUERIES.some((q) => q.basis === 'voluntary')).toBe(true);
    for (const q of QUERIES) {
      expect(q.queryBody).toContain('SELECT');
      expect(q.question.length).toBeGreaterThan(10);
      expect(q.returnNotes.length).toBeGreaterThan(0);
    }
  });

  it('queryById resolves', () => {
    expect(queryById(QUERIES[0].id)?.id).toBe(QUERIES[0].id);
    expect(queryById('nope')).toBeUndefined();
  });
});

describe('runQuery', () => {
  const statutory = QUERIES.find((q) => q.basis === 'statutory' && !q.needsEdtech)!;
  const voluntary = QUERIES.find((q) => q.basis === 'voluntary' && !q.needsEdtech)!;

  it('is deterministic', () => {
    const a = runQuery(statutory, []);
    const b = runQuery(statutory, []);
    expect(a).toEqual(b);
  });

  it('full participation: every supplier answers, coverage 100%', () => {
    const run = runQuery(voluntary, []);
    expect(run.partials).toHaveLength(SUPPLIERS.length);
    for (const p of run.partials) {
      expect(p.status).toBe('answered');
      expect(p.value).toBeGreaterThan(0);
      expect(p.payloadKB).toBeGreaterThan(0);
    }
    expect(run.assembled.coveragePct).toBe(100);
    expect(run.assembled.partial).toBe(false);
    expect(run.assembled.totalValue).toBe(run.partials.reduce((a, p) => a + p.value, 0));
  });

  it('voluntary basis honours opt-outs: coverage drops, answer flagged partial', () => {
    const run = runQuery(voluntary, ['sup-arbor', 'sup-bromcom']);
    const arbor = run.partials.find((p) => p.supplierId === 'sup-arbor')!;
    expect(arbor.status).toBe('opted-out');
    expect(arbor.value).toBe(0);
    expect(run.assembled.coveragePct).toBeLessThan(100);
    expect(run.assembled.partial).toBe(true);
    expect(run.assembled.optedOut).toContain('Arbor');
    expect(run.assembled.overridden).toHaveLength(0);
  });

  it('statutory basis overrides opt-outs: gateway must answer, objection logged', () => {
    const run = runQuery(statutory, ['sup-arbor']);
    const arbor = run.partials.find((p) => p.supplierId === 'sup-arbor')!;
    expect(arbor.status).toBe('must-answer');
    expect(arbor.value).toBeGreaterThan(0);
    expect(run.assembled.coveragePct).toBe(100);
    expect(run.assembled.partial).toBe(false);
    expect(run.assembled.overridden).toContain('Arbor');
    expect(run.assembled.optedOut).toHaveLength(0);
  });

  it('edtech-sourced questions draw partials from the tendrils', () => {
    const edq = QUERIES.find((q) => q.needsEdtech)!;
    const run = runQuery(edq, []);
    const edtechIds = new Set(EDTECH.map((e) => e.id));
    expect(run.partials.length).toBeGreaterThanOrEqual(3);
    for (const p of run.partials) {
      expect(p.providerKind).toBe('edtech');
      expect(edtechIds.has(p.supplierId)).toBe(true);
    }
  });
});

describe('buildQueryScenario', () => {
  const voluntary = QUERIES.find((q) => q.basis === 'voluntary' && !q.needsEdtech)!;

  it('produces an engine-playable scenario over real topology nodes', () => {
    const scenario = buildQueryScenario(runQuery(voluntary, []));
    expect(scenario.id).toBe(`ask-${voluntary.id}`);
    expect(scenario.steps.length).toBeGreaterThanOrEqual(3);
    expect(scenario.contract).toBeDefined();
    for (const step of scenario.steps) {
      expect(step.narration.length).toBeGreaterThan(20);
      for (const a of step.actions) {
        for (const ref of nodeRefs(a)) {
          expect(topo.byId.has(ref), `unknown node "${ref}"`).toBe(true);
        }
      }
    }
  });

  it('renders refusals for opted-out suppliers on a voluntary ask', () => {
    const scenario = buildQueryScenario(runQuery(voluntary, ['sup-arbor']));
    const actions = scenario.steps.flatMap((s) => s.actions);
    expect(actions.some((a) => a.kind === 'pulse' && a.color === 'refuse' && a.from === 'sup-arbor')).toBe(true);
    expect(actions.some((a) => a.kind === 'counter' && a.key === 'refusals')).toBe(true);
  });

  it('renders no refusal pulses when a statutory ask overrides an opt-out', () => {
    const statutory = QUERIES.find((q) => q.basis === 'statutory' && !q.needsEdtech)!;
    const scenario = buildQueryScenario(runQuery(statutory, ['sup-arbor']));
    const actions = scenario.steps.flatMap((s) => s.actions);
    expect(actions.some((a) => a.kind === 'pulse' && a.color === 'refuse')).toBe(false);
    // every supplier still returns an answer
    const okReturns = actions.filter((a) => a.kind === 'pulse' && a.color === 'ok' && a.to === 'con-dfe');
    expect(okReturns.length).toBe(SUPPLIERS.length);
  });
});
