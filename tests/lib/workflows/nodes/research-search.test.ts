import { describe, it, expect, vi, beforeEach } from 'vitest';

const { searchResearchMock } = vi.hoisted(() => ({ searchResearchMock: vi.fn() }));
vi.mock('$lib/deepdive/research-search', () => ({ searchResearch: searchResearchMock }));

import { researchSearchExecutor } from '$lib/workflows/nodes/research-search';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return makeExecutionContext({
    runId: 'r1',
    workflowId: 'w1',
    workspaceDir: '/tmp',
    _currentNodeId: 'rs-1',
    ...overrides,
  });
}

const hit = () => ({
  kind: 'fact' as const,
  factId: 'x1',
  passage: 'schools received funding',
  score: 0.72,
  confidence: 0.9,
  sessionId: 's1',
  sessionTopic: 'school funding',
  sourceId: 'src1',
  sourceTitle: 'DfE report',
  sourceUrl: 'https://gov.uk/report',
  domain: 'gov.uk',
});

beforeEach(() => {
  searchResearchMock.mockReset();
});

describe('research-search executor', () => {
  it('empty query → throws', async () => {
    await expect(researchSearchExecutor.execute({}, { query: '   ' }, makeCtx())).rejects.toThrow(/query is required/i);
  });

  it('interpolates the query, passes topK, and maps hits to a clean shape', async () => {
    searchResearchMock.mockResolvedValue([hit()]);
    const res = await researchSearchExecutor.execute(
      { topic: 'tutoring impact' },
      { query: '{{input.topic}}', topK: 12 },
      makeCtx(),
    );
    expect(searchResearchMock).toHaveBeenCalledWith('tutoring impact', { topK: 12 });
    expect(res.output).toMatchObject({ query: 'tutoring impact', count: 1 });
    expect((res.output.results as unknown[])[0]).toEqual({
      kind: 'fact',
      snippet: 'schools received funding',
      score: 0.72,
      sessionId: 's1',
      sessionTopic: 'school funding',
      sourceTitle: 'DfE report',
      sourceUrl: 'https://gov.uk/report',
      domain: 'gov.uk',
    });
    expect(res.rowCount).toBe(1);
  });

  it('clamps a non-numeric topK to the default (8)', async () => {
    searchResearchMock.mockResolvedValue([]);
    await researchSearchExecutor.execute({}, { query: 'x' }, makeCtx());
    expect(searchResearchMock).toHaveBeenCalledWith('x', { topK: 8 });
  });
});
