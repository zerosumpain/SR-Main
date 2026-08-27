import { describe, it, expect } from 'vitest';
import { insightToCandidate, MIN_BRIDGE_SCORE } from './intel-bridge';

const insight = {
  id: 'ins-1',
  kind: 'emerging_hub',
  title: 'Acme Ltd is becoming a hub',
  explanation: 'Mentioned in 9 notes across 3 sources this fortnight, up from 1.',
  score: 0.8,
  components: { growth: 0.6, breadth: 0.2 },
  entityIds: ['e1', 'e2'],
  dedupeKey: 'emerging_hub:e1',
  proposedActions: [{ kind: 'briefing', label: 'Add to briefing', payload: 'e1' }],
};

describe('insightToCandidate', () => {
  it('maps an insight into a namespaced, deduped candidate', () => {
    const c = insightToCandidate(insight);
    expect(c).toMatchObject({
      kind: 'intel_emerging_hub',
      rawScore: 0.8,
      dedupeKey: 'intel:emerging_hub:e1',
    });
    expect(c?.evidence[0]).toMatchObject({ kind: 'intel', id: 'ins-1' });
    expect(c?.evidence[0].note).toContain('Acme');
  });

  it('drops insights below the bridge bar rather than diluting the ledger', () => {
    expect(insightToCandidate({ ...insight, score: MIN_BRIDGE_SCORE - 0.01 })).toBeNull();
  });

  it('clamps a graph score above 1 instead of trusting it', () => {
    expect(insightToCandidate({ ...insight, score: 3 })?.rawScore).toBe(1);
  });

  it('refuses an insight with no explanation — a thought must be explainable', () => {
    expect(insightToCandidate({ ...insight, explanation: '  ' })).toBeNull();
  });
});
