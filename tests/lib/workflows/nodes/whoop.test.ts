import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryWhoop = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/health-service', () => ({ queryWhoop }));

import { whoopExecutor } from '$lib/workflows/nodes/whoop';
import type { ExecutionContext } from '$lib/workflows/types';

const context = {} as ExecutionContext;

describe('WHOOP workflow live operations', () => {
  beforeEach(() => queryWhoop.mockReset().mockResolvedValue([{ id: 1 }]));

  for (const [operation, key] of [
    ['get_cycles', 'cycles'],
    ['get_recovery', 'recoveries'],
    ['get_sleep', 'sleeps'],
    ['get_workouts', 'workouts'],
  ]) {
    it(`gets ${key} from Health`, async () => {
      const result = await whoopExecutor.execute({}, { operation }, context);
      expect(queryWhoop).toHaveBeenCalledWith(operation, { limit: 10 });
      expect(result.output[key]).toEqual([{ id: 1 }]);
      expect(result.rowCount).toBe(1);
    });
  }

  it('passes range options to Health', async () => {
    await whoopExecutor.execute({}, {
      operation: 'get_cycles', limit: 5, start: '2026-01-01', end: '2026-04-01',
    }, context);
    expect(queryWhoop).toHaveBeenCalledWith('get_cycles', {
      limit: 5, start: '2026-01-01', end: '2026-04-01',
    });
  });

  it('rejects unknown operations before calling Health', async () => {
    await expect(whoopExecutor.execute({}, { operation: 'unknown_op' }, context))
      .rejects.toThrow('Unknown Whoop operation: unknown_op');
    expect(queryWhoop).not.toHaveBeenCalled();
  });
});
