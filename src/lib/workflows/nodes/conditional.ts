import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const conditionalExecutor: NodeExecutor = {
  type: 'conditional',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const expression = (config.expression as string) || 'false';
    let selected: 'true' | 'false' = 'false';

    try {
      const fn = new Function('input', `return !!(${expression})`);
      const result = fn(input);
      selected = result ? 'true' : 'false';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: { ...input, error: `Conditional expression error: ${message}` },
        metadata: { _selectedHandle: 'false' },
      };
    }

    return {
      output: { ...input },
      metadata: { _selectedHandle: selected },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available as `input` in expression' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Input passed through to selected branch' };
  },
};

export const conditionalDef: NodeDefinition = {
  type: 'conditional',
  label: 'Conditional',
  category: 'control',
  description: 'Evaluates a JS boolean expression and routes to the "true" or "false" output handle.',
  configSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Boolean JS expression. `input` is the input object. e.g. input.count > 10',
      },
    },
    required: ['expression'],
  },
  defaultConfig: { expression: 'false' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'true', type: 'any', label: 'True' },
    { name: 'false', type: 'any', label: 'False' },
  ],
};
