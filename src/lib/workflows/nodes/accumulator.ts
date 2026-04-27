import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const accumulatorExecutor: NodeExecutor = {
  type: 'accumulator',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const collectField = (config.collectField as string) || '';

    let items: unknown[];

    if (collectField) {
      const value = input[collectField];
      if (value === undefined) {
        items = [input];
      } else if (Array.isArray(value)) {
        items = value;
      } else {
        items = [value];
      }
    } else {
      items = [input];
    }

    return { output: { items, count: items.length }, rowCount: items.length };
  },

  getInputSchema() {
    return { type: 'object', description: 'Input data to collect into an array' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        items: { type: 'array', description: 'Accumulated items across runs' },
        count: { type: 'number', description: 'Number of accumulated items' },
      },
    };
  },
};

export const accumulatorDef: NodeDefinition = {
  type: 'accumulator',
  label: 'Accumulator',
  category: 'control',
  description: 'Collect results from upstream into an array. Use after parallel branches or loops.',
  configSchema: {
    type: 'object',
    properties: {
      collectField: {
        type: 'string',
        description: 'Field to collect (omit for entire input)',
      },
    },
  },
  defaultConfig: { collectField: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Accumulated' }],
  basicConfig: [
    {
      key: 'collectField',
      label: 'Field to Collect',
      type: 'template-textarea',
      placeholder: 'results',
      description:
        'Dot-path into input to collect. Leave empty to collect the entire input object.',
    },
  ],
  llmDescription:
    'Use after fan-out/parallel branches or loops to gather all results into a single array.',
};
