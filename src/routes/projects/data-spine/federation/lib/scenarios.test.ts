import { describe, it, expect } from 'vitest';
import { SCENARIOS, SCENARIO_GROUPS, scenarioById } from './scenarios';
import { buildTopology } from './topology';
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

describe('the scenario catalogue', () => {
  it('has 14 scenarios covering all four groups', () => {
    expect(SCENARIOS).toHaveLength(14);
    for (const g of SCENARIO_GROUPS) {
      expect(SCENARIOS.some((s) => s.group === g)).toBe(true);
    }
  });

  it('has unique ids and non-empty narrative fields', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENARIOS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.lesson.length).toBeGreaterThan(20);
      expect(s.steps.length).toBeGreaterThanOrEqual(3);
      expect(s.central.note.length).toBeGreaterThan(0);
      for (const step of s.steps) {
        expect(step.narration.length).toBeGreaterThan(20);
        expect(step.holdMs).toBeGreaterThanOrEqual(1000);
      }
    }
  });

  it('only references nodes that exist in the topology', () => {
    for (const s of SCENARIOS) {
      for (const step of s.steps) {
        for (const a of step.actions) {
          for (const ref of nodeRefs(a)) {
            expect(topo.byId.has(ref), `${s.id}: unknown node "${ref}"`).toBe(true);
          }
        }
      }
    }
  });

  it('fanout suppliers are actual suppliers', () => {
    for (const s of SCENARIOS) {
      for (const step of s.steps) {
        for (const a of step.actions) {
          if (a.kind === 'fanout') {
            expect(topo.supplierIds, `${s.id}: fanout on non-supplier "${a.supplier}"`).toContain(a.supplier);
          }
        }
      }
    }
  });

  it('scenarioById resolves', () => {
    expect(scenarioById('census')?.group).toBe('Collections & statistics');
    expect(scenarioById('nope')).toBeUndefined();
  });

  it('queryId links resolve to real catalogue queries', async () => {
    const { queryById } = await import('./queries');
    for (const s of SCENARIOS) {
      if (s.queryId) {
        expect(queryById(s.queryId), `${s.id}: unknown queryId "${s.queryId}"`).toBeDefined();
      }
    }
    expect(SCENARIOS.some((s) => s.queryId)).toBe(true);
  });
});
