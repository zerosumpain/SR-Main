import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { interpolateTemplate } from './template';

export { jkaiDef } from './jkai.def';

export const jkaiExecutor: NodeExecutor = {
  type: 'jkai',

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
        const prompt = interpolateTemplate((config.prompt as string) || '', input);
        const title = interpolateTemplate((config.title as string) || '', input);
        if (!prompt) return { output: { success: false, error: 'Prompt is required to start a build' }, rowCount: 1 };
        const args: Record<string, unknown> = { prompt };
        if (title) args.title = title;
        const result = await executeSiteTool('jkai_start', args);
        return { output: result, rowCount: 1 };
      }

      case 'status': {
        const buildId = interpolateTemplate((config.buildId as string) || '', input);
        if (!buildId) return { output: { success: false, error: 'Build ID is required' }, rowCount: 1 };
        const result = await executeSiteTool('jkai_status', { buildId });
        return { output: result, rowCount: 1 };
      }

      case 'list': {
        const result = await executeSiteTool('jkai_list_builds', {});
        return { output: result, rowCount: 1 };
      }

      case 'control': {
        const buildId = interpolateTemplate((config.buildId as string) || '', input);
        const action = config.action as string;
        if (!buildId) return { output: { success: false, error: 'Build ID is required' }, rowCount: 1 };
        if (!action) return { output: { success: false, error: 'Action is required' }, rowCount: 1 };
        const result = await executeSiteTool('jkai_control', { buildId, action });
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

