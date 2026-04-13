import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, JsonSchema } from '../types';

export const transformExecutor: NodeExecutor = {
  type: 'transform',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const expression = config.expression as string | undefined;

    if (!expression) {
      return { output: { ...input } };
    }

    try {
      const fn = new Function('input', expression);
      const result = fn(input);
      const output = result && typeof result === 'object' ? result : { result };
      return { output };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: { error: message },
        logs: [`Transform error: ${message}`],
      };
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Any data from upstream nodes' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    if (config.outputSchema && typeof config.outputSchema === 'object') {
      return config.outputSchema as JsonSchema;
    }
    if (!config.expression) {
      return { type: 'object', description: 'Input passed through unchanged' };
    }
    return { type: 'object', description: 'Result of transform expression' };
  },
};

export const transformDef: NodeDefinition = {
  type: 'transform',
  label: 'Transform',
  category: 'core',
  description: 'Reshape data with a JavaScript expression. The input object is available as `input`.',
  configSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'JS function body. Use `input` to access upstream data. Must return an object.',
      },
      outputSchema: {
        type: 'object',
        description: 'Optional: declare the output shape so downstream nodes get autocomplete. e.g. { "score": { "type": "number" }, "label": { "type": "string" } }',
      },
    },
  },
  defaultConfig: { expression: 'return { ...input }' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    { key: 'expression', label: 'Transform Expression', type: 'code', placeholder: 'return { ...input, newField: input.value * 2 }' },
    { key: 'outputSchema', label: 'Output Schema (optional)', type: 'textarea', advancedOnly: true },
  ],
};
