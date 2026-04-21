import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures mocks are available when the hoisted vi.mock factory runs.
const { executeSiteToolMock } = vi.hoisted(() => {
  const executeSiteToolMock = vi.fn();
  return { executeSiteToolMock };
});

vi.mock('$lib/workflows/site-tools/executor', () => ({
  executeSiteTool: executeSiteToolMock,
}));

import { deepResearchExecutor } from '$lib/workflows/nodes/deep-research';

function ctx() {
  return { workflowId: 'w1', runId: 'r1', emit: vi.fn(), getOutgoingEdges: () => [] } as any;
}

describe('deep-research executor', () => {
  beforeEach(() => {
    executeSiteToolMock.mockReset();
  });

  it('returns error when topic is missing', async () => {
    const res = await deepResearchExecutor.execute({}, { topic: '' }, ctx());
    expect(res.output.success).toBe(false);
    expect(res.output.error).toMatch(/topic/i);
  });

  it('happy path: starts, polls until complete, returns report', async () => {
    // research_start → returns session id
    executeSiteToolMock
      .mockResolvedValueOnce({ success: true, data: { id: 'sess-42', status: 'pending' } })
      // research_status → running
      .mockResolvedValueOnce({ success: true, data: { id: 'sess-42', status: 'running' } })
      // research_status → complete
      .mockResolvedValueOnce({ success: true, data: { id: 'sess-42', status: 'completed' } })
      // research_get_report
      .mockResolvedValueOnce({
        success: true,
        data: {
          topic: 'AI impact',
          status: 'completed',
          report: '## Summary\nKey findings.',
        },
      });

    const res = await deepResearchExecutor.execute(
      {},
      { topic: 'AI impact', goals: 'understand risks', depth: 'medium', pollIntervalMs: 1, maxWaitMs: 5000 },
      ctx(),
    );

    expect(executeSiteToolMock).toHaveBeenNthCalledWith(1, 'research_start', expect.objectContaining({ topic: 'AI impact' }));
    expect(executeSiteToolMock).toHaveBeenCalledWith('research_get_report', { id: 'sess-42' });
    expect(res.output.success).toBe(true);
    expect(res.output.researchEngine).toBe('deep');
    expect(res.output.researchSessionId).toBe('sess-42');
    expect(res.output.researchReport).toContain('Key findings');
  });

  it('returns failed status when session fails', async () => {
    executeSiteToolMock
      .mockResolvedValueOnce({ success: true, data: { id: 'sess-f', status: 'pending' } })
      .mockResolvedValueOnce({ success: true, data: { id: 'sess-f', status: 'failed' } });

    const res = await deepResearchExecutor.execute(
      {},
      { topic: 'something', pollIntervalMs: 1, maxWaitMs: 5000 },
      ctx(),
    );

    expect(res.output.success).toBe(false);
    expect(res.output.researchStatus).toBe('failed');
  });

  it('returns timeout failure when maxWaitMs exceeded', async () => {
    // Always return running
    executeSiteToolMock
      .mockResolvedValueOnce({ success: true, data: { id: 'sess-t', status: 'pending' } })
      .mockResolvedValue({ success: true, data: { id: 'sess-t', status: 'running' } });

    const res = await deepResearchExecutor.execute(
      {},
      { topic: 'timeout test', pollIntervalMs: 1, maxWaitMs: 10 },
      ctx(),
    );

    expect(res.output.success).toBe(false);
    expect(res.output.error).toMatch(/timeout/i);
  });
});
