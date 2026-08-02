import type { NodeExecutor, NodeDefinition, NodeResult } from '../types';

// Merge is intentionally one-mode: it deep-merges every upstream input into
// a single object. Field-picking used to live here behind a `strategy: pick`
// toggle, but it overlapped with `transform` and consistently confused the
// orchestrator. If you need a subset of fields, use `transform` with
// `return { field1: input.field1, field2: input.field2 };`.
export const mergeExecutor: NodeExecutor = {
  type: 'merge',
  async execute(input, _config, _context): Promise<NodeResult> {
    const merged = (input as { merged?: unknown }).merged;
    return { output: { ...input }, rowCount: Array.isArray(merged) ? merged.length : 1 };
  },
  getInputSchema() { return { type: 'object', description: 'Merged data from all upstream nodes' }; },
  getOutputSchema() { return { type: 'object', description: 'Shallow combination of every upstream output' }; },
};

export const mergeDef: NodeDefinition = {
  type: 'merge',
  label: 'Merge',
  category: 'control',
  description:
    'Combine the outputs of every upstream node into a single object. Use after parallel branches converge. ' +
    'Keys are merged flat — if two branches emit the same key, one overwrites the other.',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Merged' }],
  basicConfig: [],
  llmDescription:
    'Use after parallel branches converge to combine all upstream outputs into one object. Has no config — it always merges. ' +
    'To select a subset of fields, follow with a `transform` node. ' +
    'IMPORTANT: this merges keys FLAT and does NOT namespace by source node, so it does NOT make ' +
    'same-shaped branches safe. Two `api-call` nodes both emit success/api/status/url/json, so wiring ' +
    'both into one node (with or without a merge) means whichever finishes last overwrites the other ' +
    'and that data is lost. When parallel branches emit the same keys, put a small `transform` on EACH ' +
    'branch first to give it its own key — `return { accounts: input.json.results };` on one, ' +
    '`return { cards: input.json.results };` on the other — then read those keys downstream.',
  llmExamples: [{}],
};
