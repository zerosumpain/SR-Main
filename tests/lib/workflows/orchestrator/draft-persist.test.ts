import { describe, it, expect } from 'vitest';
import { serializeDraft, deserializeDraft } from '$lib/workflows/orchestrator/draft-serde';
import type { WorkflowDraft } from '$lib/workflows/orchestrator/types';

function makeDraft(): WorkflowDraft {
  const draft: WorkflowDraft = {
    nodes: new Map(),
    edges: [],
    newNodeTypes: [],
    searchLog: [],
    decisions: [],
  };
  draft.nodes.set('n1', {
    id: 'n1',
    type: 'transform',
    config: { expression: 'return input' },
    label: 'T1',
    reason: 'test',
    alternatives: [{ nodeType: 'code-execute', whyRejected: 'overkill' }],
  });
  draft.edges.push({ id: 'e1', source: 'trigger', target: 'n1' });
  draft.decisions.push({ type: 'use_node', summary: 'Added T1', timestamp: Date.now() });
  return draft;
}

describe('draft serialization', () => {
  it('round-trips a draft through JSON', () => {
    const original = makeDraft();
    const json = serializeDraft(original);
    const restored = deserializeDraft(json);

    expect(restored.nodes.size).toBe(1);
    expect(restored.nodes.get('n1')?.type).toBe('transform');
    expect(restored.edges).toHaveLength(1);
    expect(restored.decisions).toHaveLength(1);
  });

  it('handles empty draft', () => {
    const empty: WorkflowDraft = {
      nodes: new Map(),
      edges: [],
      newNodeTypes: [],
      searchLog: [],
      decisions: [],
    };
    const json = serializeDraft(empty);
    const restored = deserializeDraft(json);
    expect(restored.nodes.size).toBe(0);
    expect(restored.edges).toHaveLength(0);
  });

  it('preserves trigger field', () => {
    const draft: WorkflowDraft = {
      nodes: new Map(),
      edges: [],
      newNodeTypes: [],
      searchLog: [],
      decisions: [],
      trigger: { type: 'webhook' },
    };
    const restored = deserializeDraft(serializeDraft(draft));
    expect(restored.trigger).toEqual({ type: 'webhook' });
  });
});
