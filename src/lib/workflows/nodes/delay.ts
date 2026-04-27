import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const delayExecutor: NodeExecutor = {
  type: 'delay',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const ms = (config.milliseconds as number) || 0;
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { output: { ...input }, rowCount: 1 };
  },

  getInputSchema() {
    return { type: 'object', description: 'Passed through unchanged after the delay' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Same as input — passed through after delay' };
  },
};

export const delayDef: NodeDefinition = {
  type: 'delay',
  label: 'Delay',
  category: 'control',
  description: 'Wait a fixed duration, then pass input through unchanged.',
  configSchema: {
    type: 'object',
    properties: {
      milliseconds: { type: 'number', description: 'Delay in milliseconds' },
    },
    required: ['milliseconds'],
  },
  defaultConfig: { milliseconds: 1000 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    {
      key: 'milliseconds',
      label: 'Delay',
      type: 'number',
      description: 'Pause time in milliseconds (1000 = 1 second).',
      placeholder: '1000',
      min: 0,
    },
  ],
};
