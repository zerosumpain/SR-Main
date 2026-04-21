import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures mocks are available when the hoisted vi.mock factory runs.
const { startQuickAnswerMock, dbMock } = vi.hoisted(() => {
  const startQuickAnswerMock = vi.fn();
  const dbMock = {
    insert: vi.fn(),
    select: vi.fn(),
  };
  return { startQuickAnswerMock, dbMock };
});

vi.mock('$lib/quickanswer/worker', () => ({
  startQuickAnswer: startQuickAnswerMock,
  getEmitter: () => ({ on: vi.fn(), off: vi.fn() }),
}));
vi.mock('$lib/db', () => ({ db: dbMock }));
vi.mock('$lib/db/schema', () => ({ quickAnswers: {} }));

import { quickAnswerExecutor } from '$lib/workflows/nodes/quick-answer';

function ctx() {
  return { workflowId: 'w1', runId: 'r1', emit: vi.fn(), getOutgoingEdges: () => [] } as any;
}

describe('quick-answer executor', () => {
  beforeEach(() => {
    startQuickAnswerMock.mockReset();
    dbMock.insert.mockReset();
    dbMock.select.mockReset();
  });

  it('errors when topic is empty after interpolation', async () => {
    const res = await quickAnswerExecutor.execute({}, { topic: '' }, ctx());
    expect(res.output.success).toBe(false);
  });

  it('inserts row, starts worker, polls for completion', async () => {
    // Insert returns a row id.
    const returning = vi.fn().mockResolvedValue([{ id: 'qa-1' }]);
    dbMock.insert.mockReturnValue({ values: () => ({ returning }) });
    // Select returns a completed row on first poll.
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              { id: 'qa-1', topic: 'x', status: 'complete', answer: 'ok', sources: [], durationMs: 500 },
            ]),
        }),
      }),
    });
    startQuickAnswerMock.mockResolvedValue(undefined);

    const res = await quickAnswerExecutor.execute(
      {},
      { topic: 'x', goals: ['g1'], pollIntervalMs: 1, maxWaitMs: 100 },
      ctx(),
    );
    expect(startQuickAnswerMock).toHaveBeenCalledWith('qa-1');
    expect(res.output.success).toBe(true);
    expect(res.output.researchSessionId).toBe('qa-1');
    expect(res.output.researchReport).toBe('ok');
  });
});
