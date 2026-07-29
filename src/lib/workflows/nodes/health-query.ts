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
      return { output: { success: false, error: 'No operation configured' }, rowCount: 1 };
    }

    // Registered tool names are `health_<operation>` (see site-tools/tools/health.ts).
    // This used to build `site_health_<operation>`, which never resolved — every
    // health-query node returned `{success:false, error:"Unknown tool: …"}` and
    // downstream LLM nodes invented the numbers instead (2026-07-29).
    const toolName = `health_${operation}`;

    switch (operation) {
      case 'stats':
      case 'readiness':
      case 'sleep':
      case 'training_load': {
        const result = await executeSiteTool(toolName, {});
        const points = (result as { points?: unknown[]; rows?: unknown[] }).points;
        const rows = (result as { points?: unknown[]; rows?: unknown[] }).rows;
        const rowCount = points?.length ?? rows?.length ?? 1;
        return { output: result, rowCount };
      }

      case 'timeline': {
        const page = parseInt(interpolateTemplate((config.page as string) || '', input)) || 1;
        const limit = parseInt(interpolateTemplate((config.limit as string) || '', input)) || 20;
        const result = await executeSiteTool(toolName, { page, limit });
        const points = (result as { points?: unknown[]; rows?: unknown[] }).points;
        const rows = (result as { points?: unknown[]; rows?: unknown[] }).rows;
        const rowCount = points?.length ?? rows?.length ?? 1;
        return { output: result, rowCount };
      }

      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` }, rowCount: 1 };
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

