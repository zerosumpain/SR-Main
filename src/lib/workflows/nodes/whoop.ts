import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { getValidToken } from '$lib/health/tokens';
import { getWhoopCycles, getWhoopRecoveries, getWhoopSleeps, getWhoopWorkouts } from '$lib/health/whoop';

export { whoopDef } from './whoop.def';

export const whoopExecutor: NodeExecutor = {
  type: 'whoop',

  async execute(
    _input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'get_cycles';
    const token = await getValidToken('whoop');
    if (!token) throw new Error('Whoop token not available. Connect Whoop in Health settings.');

    const limit = (config.limit as number) ?? 10;
    const start = config.start as string | undefined;
    const end = config.end as string | undefined;
    const opts = { limit, ...(start ? { start } : {}), ...(end ? { end } : {}) };

    switch (operation) {
      case 'get_cycles': {
        const cycles = await getWhoopCycles(token, opts);
        return { output: { cycles, count: cycles.length } };
      }
      case 'get_recovery': {
        const recoveries = await getWhoopRecoveries(token, opts);
        return { output: { recoveries, count: recoveries.length } };
      }
      case 'get_sleep': {
        const sleeps = await getWhoopSleeps(token, opts);
        return { output: { sleeps, count: sleeps.length } };
      }
      case 'get_workouts': {
        const workouts = await getWhoopWorkouts(token, opts);
        return { output: { workouts, count: workouts.length } };
      }
      default:
        throw new Error(`Unknown Whoop operation: ${operation}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Optional overrides (limit, start, end)' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const op = (config.operation as string) || 'get_cycles';
    const arrayKey = (
      { get_cycles: 'cycles', get_recovery: 'recoveries', get_sleep: 'sleeps', get_workouts: 'workouts' } as Record<string, string>
    )[op] ?? 'records';
    return {
      type: 'object',
      properties: {
        [arrayKey]: { type: 'array', description: `Array of Whoop ${op.replace('get_', '')} records` },
        count: { type: 'number' },
      },
    };
  },
};

