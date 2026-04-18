import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';

export { errorHandlerDef } from './error-handler.def';

export const errorHandlerExecutor: NodeExecutor = {
  type: 'error-handler',

  async execute(
    input: Record<string, unknown>,
    _config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const hasError = input.error !== undefined;
    return {
      output: { ...input },
      metadata: { _selectedHandle: hasError ? 'error' : 'success' },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Input data, optionally containing an error field' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Input passed through to selected branch' };
  },
};

