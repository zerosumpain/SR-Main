import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { safeFunction, UnsafeExpressionError } from './safe-eval';

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
      const fn = safeFunction(['input'], `return !!(${expression})`);
      const result = fn(input);
      selected = result ? 'true' : 'false';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: { ...input, error: `Conditional expression error: ${message}` },
        metadata: { _selectedHandle: 'false' },
        rowCount: 1,
      };
    }

    return {
      output: { ...input },
      metadata: { _selectedHandle: selected },
      rowCount: 1,
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
  basicConfig: [
    {
      key: 'expression',
      label: 'Condition',
      type: 'template-textarea',
      description: 'A yes/no test. If it is true, the workflow goes down the "true" branch; otherwise the "false" branch. Access upstream data with input.field.',
      placeholder: 'input.value > 10',
    },
  ],
  llmDescription: 'Expression must be a SINGLE boolean expression — NOT multi-line code. No const/let/var, no if/else, no blocks. Just one expression that evaluates to true or false. Examples: "input.score > 80", "input.status === 200", "Math.abs(input.current - input.previous) > 2". The expression is evaluated as: new Function("input", "return (" + expression + ")"). Connect the "true" output handle to the success path and "false" to the alternative path using sourceHandle in connect_nodes.',
  llmExamples: [{ expression: 'input.value > 10' }],
};
