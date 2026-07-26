import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/health/tokens', () => ({
  getValidToken: vi.fn().mockResolvedValue('mock-whoop-token'),
}));

vi.mock('$lib/health/whoop', () => ({
  getWhoopCycles: vi.fn().mockResolvedValue([{ id: 1, score: { strain: 12.5 } }]),
  getWhoopRecoveries: vi.fn().mockResolvedValue([{ cycle_id: 1, score: { recovery_score: 78 } }]),
  getWhoopSleeps: vi.fn().mockResolvedValue([{ id: 1, score: { sleep_performance_percentage: 85 } }]),
  getWhoopWorkouts: vi.fn().mockResolvedValue([{ id: 1, score: { strain: 8.2 } }]),
}));

import { whoopExecutor } from '$lib/workflows/nodes/whoop';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

const mockContext: ExecutionContext = makeExecutionContext();

describe('whoopExecutor', () => {
  it('get_cycles returns cycles array', async () => {
    const result = await whoopExecutor.execute({}, { operation: 'get_cycles' }, mockContext);
    expect(result.output.cycles).toHaveLength(1);
  });

  it('get_recovery returns recoveries', async () => {
    const result = await whoopExecutor.execute({}, { operation: 'get_recovery' }, mockContext);
    const output = result.output as { recoveries: { score: { recovery_score: number } }[] };
    expect(output.recoveries[0].score.recovery_score).toBe(78);
  });

  it('get_sleep returns sleeps', async () => {
    const result = await whoopExecutor.execute({}, { operation: 'get_sleep' }, mockContext);
    expect(result.output.sleeps).toHaveLength(1);
  });

  it('get_workouts returns workouts', async () => {
    const result = await whoopExecutor.execute({}, { operation: 'get_workouts' }, mockContext);
    expect(result.output.workouts).toHaveLength(1);
  });

  it('throws on missing token', async () => {
    const { getValidToken } = await import('$lib/health/tokens');
    vi.mocked(getValidToken).mockResolvedValueOnce(null);
    await expect(
      whoopExecutor.execute({}, { operation: 'get_cycles' }, mockContext)
    ).rejects.toThrow('Whoop token not available');
  });

  it('passes limit, start, end options', async () => {
    const { getWhoopCycles } = await import('$lib/health/whoop');
    await whoopExecutor.execute(
      {},
      { operation: 'get_cycles', limit: 5, start: '2026-01-01', end: '2026-04-01' },
      mockContext
    );
    expect(getWhoopCycles).toHaveBeenCalledWith('mock-whoop-token', {
      limit: 5,
      start: '2026-01-01',
      end: '2026-04-01',
    });
  });

  it('throws on unknown operation', async () => {
    await expect(
      whoopExecutor.execute({}, { operation: 'unknown_op' }, mockContext)
    ).rejects.toThrow('Unknown Whoop operation: unknown_op');
  });

  it('returns count alongside records', async () => {
    const result = await whoopExecutor.execute({}, { operation: 'get_workouts' }, mockContext);
    expect(result.output.count).toBe(1);
  });
});
