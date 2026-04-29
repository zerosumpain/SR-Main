import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures mocks are available when the hoisted vi.mock factory runs.
const { executeSiteToolMock, dbMock } = vi.hoisted(() => {
  const executeSiteToolMock = vi.fn();
  const dbMock = {
    select: vi.fn(),
  };
  return { executeSiteToolMock, dbMock };
});

vi.mock('$lib/workflows/site-tools/executor', () => ({ executeSiteTool: executeSiteToolMock }));
vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/db/schema', () => ({ quickAnswers: {} }));

import { researchResultExecutor } from '$lib/workflows/nodes/research-result';

function ctx() {
  return { workflowId: 'w1', runId: 'r1', emit: vi.fn(), getOutgoingEdges: () => [] } as any;
}

describe('research-result executor', () => {
  beforeEach(() => {
    executeSiteToolMock.mockReset();
    dbMock.select.mockReset();
  });

  it('fails gracefully without sessionId', async () => {
    const res = await researchResultExecutor.execute({}, { engine: 'deep' }, ctx());
    expect(res.output.researchStatus).toBe('failed');
  });

  it('calls research_report for deep engine when session id is present', async () => {
    executeSiteToolMock.mockResolvedValue({
      success: true,
      data: { report: '# Hi', sources: [{ url: 'https://x', title: 't', domain: 'x' }], status: 'complete' },
    });
    const res = await researchResultExecutor.execute(
      {},
      { engine: 'deep', sessionId: 'sess-1', topic: 'x' },
      ctx(),
    );
    expect(executeSiteToolMock).toHaveBeenCalledWith('research_get_report', { id: 'sess-1' });
    expect(res.output.researchReport).toContain('Hi');
    expect(res.output.researchStatus).toBe('complete');
  });

  it('reads quick-answer row when engine=quick', async () => {
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{
            id: 'qa1',
            topic: 'x',
            status: 'complete',
            answer: 'Quick result',
            sources: [],
            durationMs: 1200,
          }]),
        }),
      }),
    });
    const res = await researchResultExecutor.execute(
      {},
      { engine: 'quick', sessionId: 'qa1', topic: 'x' },
      ctx(),
    );
    expect(res.output.researchReport).toBe('Quick result');
    expect(res.output.researchEngine).toBe('quick');
  });
});
