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

  // A budgeted tier (instant/scan/brief) finishes inside research_start, which
  // awaits the run rather than backgrounding it. Polling it would only re-read
  // a row that is already terminal, so the node returns straight from the start
  // call. Only `investigation` is unbounded enough to need the poll loop.
  describe('budgeted tiers return without polling', () => {
    it('returns the answer straight from research_start', async () => {
      executeSiteToolMock.mockResolvedValueOnce({
        success: true,
        data: {
          id: 'sess-b',
          status: 'complete',
          depth: 'brief',
          answer: 'The short answer.',
          durationMs: 41_000,
        },
      });

      const res = await deepResearchExecutor.execute(
        {},
        { topic: 'AI impact', depth: 'brief', pollIntervalMs: 1, maxWaitMs: 5000 },
        ctx(),
      );

      expect(executeSiteToolMock).toHaveBeenCalledTimes(1);
      expect(executeSiteToolMock).toHaveBeenCalledWith(
        'research_start',
        expect.objectContaining({ topic: 'AI impact', depth: 'brief' }),
      );
      expect(res.output.success).toBe(true);
      expect(res.output.researchDepth).toBe('brief');
      expect(res.output.researchReport).toBe('The short answer.');
      expect(res.output.researchDurationMs).toBe(41_000);
    });

    // The legacy vocabulary used to be dropped on the floor: the node passed
    // `depth` to a research_start that never declared the parameter.
    it('maps the legacy medium/shallow vocabulary onto real tiers', async () => {
      executeSiteToolMock.mockResolvedValue({
        success: true,
        data: { id: 'sess-l', status: 'complete', answer: 'ok' },
      });

      await deepResearchExecutor.execute({}, { topic: 'x', depth: 'medium' }, ctx());
      expect(executeSiteToolMock).toHaveBeenCalledWith(
        'research_start',
        expect.objectContaining({ depth: 'brief' }),
      );
    });

    it('surfaces a failed budgeted run as an error rather than a timeout', async () => {
      executeSiteToolMock.mockResolvedValueOnce({
        success: false,
        data: { id: 'sess-x', status: 'failed', error: 'No sources matched your scope' },
      });

      const res = await deepResearchExecutor.execute({}, { topic: 'y', depth: 'scan' }, ctx());
      expect(res.output.success).toBe(false);
      expect(res.output.error).toMatch(/no sources matched/i);
    });
  });

  it('investigation: starts, polls until complete, returns report', async () => {
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
      { topic: 'AI impact', goals: 'understand risks', depth: 'investigation', pollIntervalMs: 1, maxWaitMs: 5000 },
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
      { topic: 'something', depth: 'investigation', pollIntervalMs: 1, maxWaitMs: 5000 },
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
      { topic: 'timeout test', depth: 'investigation', pollIntervalMs: 1, maxWaitMs: 10 },
      ctx(),
    );

    expect(res.output.success).toBe(false);
    expect(res.output.error).toMatch(/timeout/i);
  });
});
