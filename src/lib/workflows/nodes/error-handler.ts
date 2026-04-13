import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

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

export const errorHandlerDef: NodeDefinition = {
  type: 'error-handler',
  label: 'Error Handler',
  category: 'control',
  description:
    'Routes to success or error output based on whether input contains an error field.',
  configSchema: {
    type: 'object',
    properties: {},
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'success', type: 'any', label: 'Success' },
    { name: 'error', type: 'any', label: 'Error' },
  ],
};
