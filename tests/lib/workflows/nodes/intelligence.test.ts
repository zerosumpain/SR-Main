import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures mocks are available when the hoisted vi.mock factory runs.
const { searchIntelMock, buildKnowledgeContextMock } = vi.hoisted(() => {
  const searchIntelMock = vi.fn();
  const buildKnowledgeContextMock = vi.fn();
  return { searchIntelMock, buildKnowledgeContextMock };
});

vi.mock('$lib/jkai/intel/search', () => ({ searchIntel: searchIntelMock }));
vi.mock('$lib/jkai/intel/context', () => ({ buildKnowledgeContext: buildKnowledgeContextMock }));

import { intelligenceExecutor } from '$lib/workflows/nodes/intelligence';

function ctx() {
  return { workflowId: 'w1', runId: 'r1', emit: vi.fn(), getOutgoingEdges: () => [] } as any;
}

describe('intelligence executor', () => {
  beforeEach(() => {
    searchIntelMock.mockReset();
    buildKnowledgeContextMock.mockReset();
    buildKnowledgeContextMock.mockResolvedValue('ctx-prose');
  });

  it('returns empty shape when query is blank and no facets', async () => {
    const res = await intelligenceExecutor.execute({}, {}, ctx());
    expect(res.output).toMatchObject({
      intelQuery: '',
      intelItems: [],
      intelCount: 0,
      intelContext: '',
    });
  });

  it('interpolates query template and passes facets to searchIntel', async () => {
    searchIntelMock.mockResolvedValue({ items: [{ id: 'n1', kind: 'note', title: 'A', snippet: 's', createdAt: '2026-04-20T00:00:00Z', score: 0.9 }], total: 1 });
    const config = {
      query: 'projects since {{input.since}}',
      facets: { entityTypes: ['project'], tags: [], timeRange: null, limit: 10, ordering: 'relevant' },
    };
    const input = { since: 'yesterday' };
    const res = await intelligenceExecutor.execute(input, config, ctx());
    expect(searchIntelMock).toHaveBeenCalledWith('projects since yesterday', expect.objectContaining({ entityTypes: ['project'] }));
    expect(res.output.intelItems).toHaveLength(1);
    expect(res.output.intelQuery).toBe('projects since yesterday');
    expect((res.output.intelFocus as any).query).toBe('projects since yesterday');
    expect(res.output.intelContext).toBe('ctx-prose');
  });
});
