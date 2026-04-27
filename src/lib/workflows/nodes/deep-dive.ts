import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';

export { deepDiveDef } from './deep-dive.def';

export const deepDiveExecutor: NodeExecutor = {
  type: 'deep-dive',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as string | undefined;
    if (!operation) {
      return { output: { success: false, error: 'No operation configured' }, rowCount: 1 };
    }

    switch (operation) {
      case 'start': {
        const topic = interpolateTemplate((config.topic as string) || '', input);
        const goals = interpolateTemplate((config.goals as string) || '', input);
        if (!topic) return { output: { success: false, error: 'Topic is required to start research' }, rowCount: 1 };
        const args: Record<string, unknown> = { topic };
        if (goals) args.goals = goals;
        if (config.depth) args.depth = config.depth;
        const result = await executeSiteTool('research_start', args);
        return { output: result, rowCount: 1 };
      }

      case 'status': {
        const sessionId = interpolateTemplate((config.sessionId as string) || '', input);
        if (!sessionId) return { output: { success: false, error: 'Session ID is required' }, rowCount: 1 };
        const result = await executeSiteTool('research_status', { id: sessionId });
        return { output: result, rowCount: 1 };
      }

      case 'list': {
        const result = await executeSiteTool('research_list', {});
        return { output: result, rowCount: 1 };
      }

      case 'report': {
        const sessionId = interpolateTemplate((config.sessionId as string) || '', input);
        if (!sessionId) return { output: { success: false, error: 'Session ID is required for report' }, rowCount: 1 };
        const result = await executeSiteTool('research_get_report', { id: sessionId });
        return { output: result, rowCount: 1 };
      }

      case 'control': {
        const sessionId = interpolateTemplate((config.sessionId as string) || '', input);
        const action = config.action as string;
        if (!sessionId) return { output: { success: false, error: 'Session ID is required' }, rowCount: 1 };
        if (!action) return { output: { success: false, error: 'Action is required' }, rowCount: 1 };
        const result = await executeSiteTool('research_control', { id: sessionId, action });
        return { output: result, rowCount: 1 };
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

