import type { NodeDefinition } from '../types';

export const loopDef: NodeDefinition = {
  type: 'loop',
  label: 'Loop',
  category: 'control',
  description:
    'Iterate over an array in the input and apply an expression to each item. Returns results array.',
  configSchema: {
    type: 'object',
    properties: {
      arrayPath: {
        type: 'string',
        description: "Dot-path into input to find the array (e.g. 'items' or 'data.values')",
      },
      expression: {
        type: 'string',
        description:
          'JS function body applied to each item. Variables: `item`, `index`, `input`. Must return a value.',
      },
      concurrency: {
        type: 'number',
        description: 'Concurrency limit (default 1; reserved for future use)',
      },
    },
    required: ['arrayPath'],
  },
  defaultConfig: { arrayPath: 'items', expression: 'return item', concurrency: 1 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'array', label: 'Results' }],
  basicConfig: [
    {
      key: 'arrayPath',
      label: 'Array Path',
      type: 'text',
      description: 'Which field on the input holds the list. Use a dot-path like items or data.values.',
      placeholder: 'items',
    },
    {
      key: 'expression',
      label: 'Per-Item Expression',
      type: 'code',
      description: 'Runs once for each item. Variables: item, index, input. Return the transformed value.',
      placeholder: 'return { id: item.id, doubled: item.value * 2 }',
    },
    {
      key: 'concurrency',
      label: 'Concurrency',
      type: 'number',
      description: 'How many items to process in parallel (default 1).',
      min: 1,
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
};
