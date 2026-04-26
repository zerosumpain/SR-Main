import type { NodeExecutor, NodeDefinition, NodeResult } from '../types';

// Merge is intentionally one-mode: it deep-merges every upstream input into
// a single object. Field-picking used to live here behind a `strategy: pick`
// toggle, but it overlapped with `transform` and consistently confused the
// orchestrator. If you need a subset of fields, use `transform` with
// `return { field1: input.field1, field2: input.field2 };`.
export const mergeExecutor: NodeExecutor = {
  type: 'merge',
  async execute(input, _config, _context): Promise<NodeResult> {
    return { output: { ...input } };
  },
  getInputSchema() { return { type: 'object', description: 'Merged data from all upstream nodes' }; },
  getOutputSchema() { return { type: 'object', description: 'Shallow combination of every upstream output' }; },
};

export const mergeDef: NodeDefinition = {
  type: 'merge',
  label: 'Merge',
  category: 'control',
  description: 'Combine the outputs of every upstream node into a single object. Use after parallel branches converge.',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Merged' }],
  basicConfig: [],
  llmDescription: 'Use after parallel branches converge to combine all upstream outputs into one object. Has no config — it always merges. To select a subset of fields, follow with a `transform` node.',
  llmExamples: [{}],
};
