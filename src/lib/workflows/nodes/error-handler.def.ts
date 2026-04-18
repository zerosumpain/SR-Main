import type { NodeDefinition } from '../types';

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
  // No configuration — routes automatically based on whether input contains an `error` field.
  basicConfig: [],
};
