import { describe, it, expect, vi } from 'vitest';
import { processToolCall, assembleWorkflow } from '$lib/workflows/orchestrator/loop';
import type { WorkflowDraft } from '$lib/workflows/orchestrator/types';

function emptyDraft(): WorkflowDraft {
  return {
    nodes: new Map(),
    edges: [],
    newNodeTypes: [],
    searchLog: [],
    decisions: [],
  };
}

describe('processToolCall', () => {
  it('processes search_nodes and records to searchLog', () => {
    const draft = emptyDraft();
    const mockSearch = vi.fn().mockReturnValue([
      { type: 'http-request', label: 'HTTP Request', description: 'Make HTTP calls', inputs: [{ name: 'input', type: 'object' }], outputs: [{ name: 'output', type: 'object' }] },
    ]);

    const result = processToolCall(
      draft,
      'search_nodes',
      { query: 'http api', category: undefined },
      { searchFn: mockSearch },
    );

    expect(result.success).toBe(true);
    expect(draft.searchLog).toHaveLength(1);
    expect(draft.searchLog[0].query).toBe('http api');
    expect(draft.searchLog[0].results).toContain('http-request');
    expect(draft.decisions).toHaveLength(1);
    expect(draft.decisions[0].type).toBe('search');
  });

  it('processes use_node and adds to draft', () => {
    const draft = emptyDraft();
    const result = processToolCall(
      draft,
      'use_node',
      {
        nodeType: 'transform',
        config: { expression: 'return input' },
        label: 'Format data',
        reason: 'Need to reshape the API response for downstream consumption',
        alternativesConsidered: [{ nodeType: 'code-execute', whyRejected: 'Overkill' }],
      },
      {},
    );

    expect(result.success).toBe(true);
    expect(draft.nodes.size).toBe(1);
    const node = Array.from(draft.nodes.values())[0];
    expect(node.type).toBe('transform');
    expect(node.label).toBe('Format data');
    expect(draft.decisions).toHaveLength(1);
    expect(draft.decisions[0].type).toBe('use_node');
  });

  it('processes connect_nodes', () => {
    const draft = emptyDraft();
    draft.nodes.set('n1', { id: 'n1', type: 'trigger', config: {}, label: 'A', reason: '', alternatives: [] });
    draft.nodes.set('n2', { id: 'n2', type: 'transform', config: {}, label: 'B', reason: '', alternatives: [] });

    const result = processToolCall(
      draft,
      'connect_nodes',
      { sourceId: 'n1', targetId: 'n2' },
      {},
    );

    expect(result.success).toBe(true);
    expect(draft.edges).toHaveLength(1);
    expect(draft.edges[0].source).toBe('n1');
    expect(draft.edges[0].target).toBe('n2');
  });

  it('rejects connect_nodes for non-existent source', () => {
    const draft = emptyDraft();
    draft.nodes.set('n1', { id: 'n1', type: 'trigger', config: {}, label: 'A', reason: '', alternatives: [] });

    const result = processToolCall(
      draft,
      'connect_nodes',
      { sourceId: 'nonexistent', targetId: 'n1' },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('nonexistent');
  });

  it('processes finalize_workflow', () => {
    const draft = emptyDraft();
    const result = processToolCall(
      draft,
      'finalize_workflow',
      { name: 'My Workflow', description: 'Does stuff' },
      {},
    );

    expect(result.success).toBe(true);
    expect(result.finalized).toBe(true);
    expect(draft.decisions).toHaveLength(1);
    expect(draft.decisions[0].type).toBe('finalize');
  });
});

describe('assembleWorkflow', () => {
  it('assembles a workflow from draft with auto-layout positions', () => {
    const draft = emptyDraft();
    draft.nodes.set('n1', { id: 'n1', type: 'manual-trigger', config: {}, label: 'Start', reason: 'Entry point', alternatives: [{ nodeType: 'none', whyRejected: 'N/A' }] });
    draft.nodes.set('n2', { id: 'n2', type: 'transform', config: { expression: 'return input' }, label: 'Transform', reason: 'Reshape data', alternatives: [{ nodeType: 'code-execute', whyRejected: 'Too heavy' }] });
    draft.edges.push({ id: 'e1', source: 'n1', target: 'n2' });

    const result = assembleWorkflow(draft, 'Test Workflow', 'A test');

    expect(result.name).toBe('Test Workflow');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    for (const node of result.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeDefined();
    }
  });
});

describe('assembleWorkflow — no auto-connect', () => {
  it('does NOT auto-connect disconnected nodes and reports warning', () => {
    const draft: WorkflowDraft = {
      nodes: new Map(),
      edges: [],
      newNodeTypes: [],
      searchLog: [],
      decisions: [],
    };
    draft.nodes.set('n1', { id: 'n1', type: 'manual-trigger', config: {}, label: 'Start', reason: 'Entry', alternatives: [] });
    draft.nodes.set('n2', { id: 'n2', type: 'transform', config: {}, label: 'T1', reason: 'Process', alternatives: [] });
    draft.nodes.set('n3', { id: 'n3', type: 'llm-call', config: {}, label: 'LLM', reason: 'Generate', alternatives: [] });
    // No edges added

    const result = assembleWorkflow(draft, 'Test', 'desc');

    expect(result.edges).toHaveLength(0);
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.[0]).toMatch(/disconnected|no edges/i);
  });
});
