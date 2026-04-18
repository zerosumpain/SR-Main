import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';

export { healthQueryDef } from './health-query.def';

export const healthQueryExecutor: NodeExecutor = {
  type: 'health-query',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as string | undefined;
    if (!operation) {
      return { output: { success: false, error: 'No operation configured' } };
    }

    const toolName = `site_health_${operation}`;

    switch (operation) {
      case 'stats':
      case 'readiness':
      case 'sleep':
      case 'training_load': {
        const result = await executeSiteTool(toolName, {});
        return { output: result };
      }

      case 'timeline': {
        const page = parseInt(interpolateTemplate((config.page as string) || '', input)) || 1;
        const limit = parseInt(interpolateTemplate((config.limit as string) || '', input)) || 20;
        const result = await executeSiteTool(toolName, { page, limit });
        return { output: result };
      }

      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` } };
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in config fields' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
        error: { type: 'string' },
      },
    };
  },
};

