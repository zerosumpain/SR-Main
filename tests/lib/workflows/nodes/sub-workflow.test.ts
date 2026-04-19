import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}));
vi.mock('$lib/db/schema', () => ({
  workflows: {},
  workflowNodes: {},
  workflowEdges: {},
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

// Mock the engine (lazily imported inside executor)
const mockExecute = vi.fn();
vi.mock('$lib/workflows', () => ({
  engine: { execute: mockExecute },
}));

import { subWorkflowExecutor } from '$lib/workflows/nodes/sub-workflow';
import { db } from '$lib/db';
import type { ExecutionContext } from '$lib/workflows/types';

const stubContext: ExecutionContext = {
  runId: 'parent-run',
  workflowId: 'parent-wf',
  workspaceDir: '/tmp/test',
  emit: vi.fn(),
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
  getOutgoingEdges: vi.fn().mockReturnValue([]),
  getNodeConfig: vi.fn(),
} as unknown as ExecutionContext;

describe('sub-workflow executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when no workflowId configured', async () => {
    const result = await subWorkflowExecutor.execute({}, {}, stubContext);
    expect(result.output).toHaveProperty('error');
  });

  it('loads workflow from DB and calls engine.execute directly', async () => {
    // Mock DB chain: select().from().where().limit() / select().from().where()
    const mockLimit = vi.fn();
    const mockWhere = vi.fn();
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    // First call: workflow row (uses .limit)
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([{ id: 'sub-wf', name: 'Sub' }]);
    // Second call: nodes (no .limit — awaited directly)
    mockWhere.mockResolvedValueOnce([
      { id: 'n1', type: 'manual-trigger', config: {}, label: 'Start', position: { x: 0, y: 0 } },
    ]);
    // Third call: edges
    mockWhere.mockResolvedValueOnce([]);

    mockExecute.mockResolvedValue({
      status: 'completed',
      nodeOutputs: new Map([['n1', { result: 42 }]]),
      nodeErrors: new Map(),
    });

    const result = await subWorkflowExecutor.execute(
      { data: 'test' },
      { workflowId: 'sub-wf' },
      stubContext,
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.output).toHaveProperty('result', 42);
    expect(result.metadata).toHaveProperty('subWorkflowId', 'sub-wf');
  });

  it('throws when sub-workflow returns failed status', async () => {
    const mockLimit = vi.fn();
    const mockWhere = vi.fn();
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([{ id: 'sub-wf', name: 'Sub' }]);
    mockWhere.mockResolvedValueOnce([]);
    mockWhere.mockResolvedValueOnce([]);

    mockExecute.mockResolvedValue({
      status: 'failed',
      nodeOutputs: new Map(),
      nodeErrors: new Map(),
      error: 'something went wrong',
    });

    await expect(
      subWorkflowExecutor.execute({}, { workflowId: 'sub-wf' }, stubContext),
    ).rejects.toThrow(/Sub-workflow failed/);
  });
});
