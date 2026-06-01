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
        items: { type: 'array', description: "Items collected from this run's input into an array" },
        count: { type: 'number', description: 'Number of items collected in this run' },
      },
    };
  },
};

export const accumulatorDef: NodeDefinition = {
  type: 'accumulator',
  label: 'Accumulator',
  category: 'control',
  description: 'Wrap the current input (or a chosen field) into an array within this run. Does NOT persist or accumulate across separate runs.',
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
    "Normalises the current run's input into an array shape { items, count } within a SINGLE run. If collectField names an array on the input, its elements become items; otherwise the value (or whole input) is wrapped as a one-element array. IMPORTANT: this does NOT persist or accumulate state across separate workflow runs — it only reshapes data inside the run it executes in. For cross-run persistence use the data-store node.",
};
