import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures mocks are available when the hoisted vi.mock factory runs.
const { runQuickAnswerSyncMock, requestStopMock, dbMock } = vi.hoisted(() => {
  const runQuickAnswerSyncMock = vi.fn();
  const requestStopMock = vi.fn();
  const dbMock = { insert: vi.fn() };
  return { runQuickAnswerSyncMock, requestStopMock, dbMock };
});

vi.mock('$lib/quickanswer/worker', () => ({
  runQuickAnswerSync: runQuickAnswerSyncMock,
  requestStop: requestStopMock,
}));
vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/db/schema', () => ({ quickAnswers: {} }));

import { quickAnswerExecutor } from '$lib/workflows/nodes/quick-answer';

function ctx() {
  return { workflowId: 'w1', runId: 'r1', emit: vi.fn(), getOutgoingEdges: () => [] } as any;
}

describe('quick-answer executor', () => {
  beforeEach(() => {
    runQuickAnswerSyncMock.mockReset();
    requestStopMock.mockReset();
    dbMock.insert.mockReset();
  });

  it('errors when topic is empty after interpolation', async () => {
    const res = await quickAnswerExecutor.execute({}, { topic: '' }, ctx());
    expect(res.output.success).toBe(false);
  });

  it('inserts a row, runs the worker synchronously, and returns the answer', async () => {
    // Insert returns the new row id.
    const returning = vi.fn().mockResolvedValue([{ id: 'qa-1' }]);
    dbMock.insert.mockReturnValue({ values: () => ({ returning }) });
    // The worker runs to completion in-process and returns the final row.
    runQuickAnswerSyncMock.mockResolvedValue({
      id: 'qa-1',
      topic: 'x',
      status: 'complete',
      answer: 'ok',
      sources: [],
      durationMs: 500,
    });

    const res = await quickAnswerExecutor.execute(
      {},
      { topic: 'x', goals: ['g1'], maxWaitMs: 100 },
      ctx(),
    );
    expect(runQuickAnswerSyncMock).toHaveBeenCalledWith('qa-1');
    expect(res.output.success).toBe(true);
    expect(res.output.researchSessionId).toBe('qa-1');
    expect(res.output.researchReport).toBe('ok');
  });
});
