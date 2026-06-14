import { describe, it, expect } from 'vitest';
import {
  initSynthesisState,
  applySynthesisEvent,
  type SynthesisEvent,
} from './synthesis-reducer';

function ev(stage: string, extra: Record<string, unknown> = {}): SynthesisEvent {
  return { seq: 1, runId: 'run-1', stage: stage as any, ...extra };
}

describe('applySynthesisEvent', () => {
  it('started clears prior tokens and marks running', () => {
    let s = initSynthesisState();
    s = applySynthesisEvent(s, ev('started', { factCount: 12, scope: { pinnedOnly: false } }));
    expect(s.runId).toBe('run-1');
    expect(s.status).toBe('running');
    expect(s.streamedText).toBe('');
    expect(s.factCount).toBe(12);
    expect(s.cardPatches).toEqual([]);
    expect(s.newEdges).toEqual([]);
  });

  it('progress tokens accumulate into streamedText', () => {
    let s = initSynthesisState();
    s = applySynthesisEvent(s, ev('started'));
    s = applySynthesisEvent(s, ev('progress', { token: 'Hel' }));
    s = applySynthesisEvent(s, ev('progress', { token: 'lo' }));
    expect(s.streamedText).toBe('Hello');
  });

  it('cluster events register the category and emit card patches for member facts', () => {
    let s = initSynthesisState();
    s = applySynthesisEvent(s, ev('started'));
    s = applySynthesisEvent(s, ev('cluster', {
      cluster: { id: 'c1', title: 'Funding', summary: 'about money', fact_ids: ['f1', 'f2'] },
    }));
    expect(s.categories).toEqual([{ id: 'c1', title: 'Funding', summary: 'about money' }]);
    // each member fact gets filed into the category + synthesized state + runId
    expect(s.cardPatches).toEqual([
      { id: 'f1', patch: { deskCategory: 'c1', deskState: 'synthesized', synthesisRunId: 'run-1' } },
      { id: 'f2', patch: { deskCategory: 'c1', deskState: 'synthesized', synthesisRunId: 'run-1' } },
    ]);
  });

  it('cluster events emit a header→fact connector edge per member fact', () => {
    let s = initSynthesisState();
    s = applySynthesisEvent(s, ev('started'));
    s = applySynthesisEvent(s, ev('cluster', {
      cluster: { id: 'c1', title: 'Funding', summary: '', fact_ids: ['f1'] },
    }));
    expect(s.newEdges).toEqual([
      { id: 'syn:c1:f1', fromId: 'cat:c1', toId: 'f1', kind: 'cluster' },
    ]);
  });

  it('dedups repeated cluster membership (idempotent on re-emit)', () => {
    let s = initSynthesisState();
    s = applySynthesisEvent(s, ev('started'));
    const c = { cluster: { id: 'c1', title: 'T', summary: '', fact_ids: ['f1'] } };
    s = applySynthesisEvent(s, ev('cluster', c));
    s = applySynthesisEvent(s, ev('cluster', c));
    expect(s.cardPatches.filter((p) => p.id === 'f1')).toHaveLength(1);
    expect(s.newEdges).toHaveLength(1);
    expect(s.categories).toHaveLength(1);
  });

  it('done sets status complete, summary and tokensUsed', () => {
    let s = initSynthesisState();
    s = applySynthesisEvent(s, ev('started'));
    s = applySynthesisEvent(s, ev('done', { summary: 'wrap up', tokensUsed: 4321, clusters: [] }));
    expect(s.status).toBe('complete');
    expect(s.summary).toBe('wrap up');
    expect(s.tokensUsed).toBe(4321);
  });

  it('ignores events from a stale runId once a newer run has started', () => {
    let s = initSynthesisState();
    s = applySynthesisEvent(s, ev('started')); // run-1
    s = applySynthesisEvent(s, { seq: 9, runId: 'run-2', stage: 'started' });
    // a late progress token from run-1 must not append
    s = applySynthesisEvent(s, { seq: 10, runId: 'run-1', stage: 'progress', token: 'X' });
    expect(s.runId).toBe('run-2');
    expect(s.streamedText).toBe('');
  });
});
