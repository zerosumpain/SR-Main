import { describe, it, expect, vi, beforeEach } from 'vitest';

// Synthetic workflow: an api-call node connected into a database node, no runs.
const ROWS: Record<string, unknown[]> = {
  NODES: [
    {
      id: 'src',
      type: 'api-call',
      position: { x: 0, y: 0 },
      config: { api: 'companies-house', method: 'GET', path: '/company/{{input.n}}' },
      label: 'Companies House',
    },
    { id: 'tgt', type: 'database', position: { x: 1, y: 1 }, config: {}, label: 'Database' },
  ],
  EDGES: [{ id: 'e1', sourceNodeId: 'src', targetNodeId: 'tgt', sourceHandle: null, targetHandle: null }],
  RUNS: [],
  EXECS: [],
};

// Mock the drizzle table sentinels + a fluent, table-aware fake db.
vi.mock('$lib/db/schema', () => ({
  workflowNodes: 'NODES',
  workflowEdges: 'EDGES',
  workflowRuns: 'RUNS',
  nodeExecutions: 'EXECS',
}));
vi.mock('drizzle-orm', () => ({ eq: () => ({}), desc: () => ({}) }));
vi.mock('$lib/db', () => {
  function chain() {
    let table: string | undefined;
    const c: Record<string, unknown> = {
      from(t: string) { table = t; return c; },
      where() { return c; },
      orderBy() { return c; },
      limit() { return c; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(ROWS[table ?? ''] ?? []).then(res, rej);
      },
    };
    return c;
  }
  return { db: { select: () => chain() } };
});

// The api-call source's output schema → gives the proposer real available paths.
vi.mock('$lib/workflows', () => ({
  registry: {
    getExecutor: (type: string) => ({
      getOutputSchema: () =>
        type === 'api-call'
          ? { type: 'object', properties: { json: { type: 'object' }, status: { type: 'number' }, url: { type: 'string' } } }
          : { type: 'object' },
    }),
  },
}));

vi.mock('$lib/server/models/workload-settings', () => ({
  resolveMappingModel: vi.fn().mockResolvedValue({ modelId: 'test-model' }),
}));

vi.mock('$lib/llm/workflow-gateway', () => ({
  resilientChatCompletion: vi.fn(),
}));

import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
import { proposeEdgeMapping } from './propose.server';

function llmReply(obj: unknown) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }] } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('proposeEdgeMapping (real registry defs + schema paths + sanitiser)', () => {
  it('returns an LLM proposal, keeping only real database config keys', async () => {
    vi.mocked(resilientChatCompletion).mockResolvedValue(
      llmReply({
        compatible: 'direct',
        rationale: 'Store each company record.',
        confidence: 0.8,
        actions: [
          { kind: 'set-config', field: 'operation', value: 'upsert', label: 'Upsert each record' },
          { kind: 'set-config', field: 'collection', value: 'companies', label: 'Store in companies' },
          { kind: 'set-config', field: 'data', value: '{{input.json}}', label: 'Store the payload' },
          { kind: 'set-config', field: 'bogusField', value: 'x', label: 'should be dropped' },
          { kind: 'note', label: 'Cite the API in downstream messages' },
        ],
      }),
    );

    const p = await proposeEdgeMapping({ workflowId: 'w1', sourceNodeId: 'src', targetNodeId: 'tgt' });
    expect(p).not.toBeNull();
    expect(p!.provenance).toBe('llm');
    expect(p!.compatibility.level).toBe('direct'); // api-call json → database any
    // Unknown config key was dropped; real keys kept.
    expect(p!.configPatch).toEqual({ operation: 'upsert', collection: 'companies', data: '{{input.json}}' });
    expect(p!.actions.some((a) => a.kind === 'note')).toBe(true);
    // {{input.json}} is a known emitted path → not flagged unverified.
    const dataAction = p!.actions.find((a) => a.field === 'data');
    expect(dataAction?.unverifiedRef).toBe(false);
  });

  it('flags a set-config value that references an unknown upstream path', async () => {
    vi.mocked(resilientChatCompletion).mockResolvedValue(
      llmReply({
        compatible: 'direct',
        confidence: 0.7,
        actions: [{ kind: 'set-config', field: 'data', value: '{{input.ghost}}', label: 'data' }],
      }),
    );
    const p = await proposeEdgeMapping({ workflowId: 'w1', sourceNodeId: 'src', targetNodeId: 'tgt' });
    expect(p!.actions.find((a) => a.field === 'data')?.unverifiedRef).toBe(true);
  });

  it('falls back to the deterministic heuristic when the LLM errors', async () => {
    vi.mocked(resilientChatCompletion).mockRejectedValue(new Error('model down'));
    const p = await proposeEdgeMapping({ workflowId: 'w1', sourceNodeId: 'src', targetNodeId: 'tgt' });
    expect(p!.provenance).toBe('heuristic');
    expect(p!.configPatch.operation).toBe('upsert');
    expect(p!.configPatch.collection).toBe('companies-house'); // derived from the source label
  });

  it('returns null when a node id is not in the workflow', async () => {
    const p = await proposeEdgeMapping({ workflowId: 'w1', sourceNodeId: 'src', targetNodeId: 'ghost' });
    expect(p).toBeNull();
  });
});
