import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const manualTriggerExecutor: NodeExecutor = {
  type: 'manual-trigger',

  async execute(
    input: Record<string, unknown>,
    _config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    return { output: { ...input } };
  },

  getInputSchema() {
    return { type: 'object', description: 'No input — this is the workflow entry point' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description: 'Passes through any data provided at run start',
    };
  },
};

export const manualTriggerDef: NodeDefinition = {
  type: 'manual-trigger',
  label: 'Manual Trigger',
  category: 'trigger',
  description: 'Starts a workflow manually. Optionally accepts initial data.',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  // Trigger-only node — no configuration needed.
  basicConfig: [],
};
