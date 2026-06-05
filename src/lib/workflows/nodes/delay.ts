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
  summarize: (config) => {
    const ms = Number(config.milliseconds ?? 0);
    const human =
      ms >= 60000
        ? `${+(ms / 60000).toFixed(ms % 60000 ? 1 : 0)} min`
        : ms >= 1000
          ? `${+(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} s`
          : `${ms} ms`;
    return { line: `Wait ${human}, then continue`, preview: { kind: 'compute', details: { Delay: human } } };
  },
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
