import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export const loopExecutor: NodeExecutor = {
  type: 'loop',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const arrayPath = (config.arrayPath as string) || '';
    const array = resolvePath(input, arrayPath);

    if (!Array.isArray(array)) {
      return { output: { error: 'Not an array', path: arrayPath } };
    }

    const results: unknown[] = [];
    for (let i = 0; i < array.length; i++) {
      if (config.expression) {
        const fn = new Function('item', 'index', 'input', config.expression as string);
        results.push(fn(array[i], i, input));
      } else {
        results.push(array[i]);
      }
    }

    return { output: { results, count: results.length } };
  },

  getInputSchema() {
    return { type: 'object', description: 'Input object containing the array to iterate' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Object with results array and count' };
  },
};

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
};
