import type { NodeDefinition } from '../types';

export const loopDef: NodeDefinition = {
  type: 'loop',
  label: 'Loop',
  category: 'control',
  description:
    'Map an array in the input through a JS expression. Returns { results, count }. NOT a control-flow loop — downstream nodes execute ONCE with the results object, not per-item.',
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
        description:
          'How many items to process at once (default 1 = sequential). Higher values run the per-item transform with that many in flight; output order always matches input order.',
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
  llmDescription:
    "CRITICAL: this is a MAP TRANSFORM, not a control-flow loop. It applies a synchronous JS expression to each array element and returns `{ results: [...], count: N }` exactly ONCE. Downstream nodes execute ONCE with that object — they DO NOT iterate per item. Therefore you CANNOT place an llm-call, http-request, data-store, or any node-that-does-IO after a loop and expect it to fire per element; the engine has no per-iteration downstream execution primitive. " +
    "Correct uses: lightweight per-item reshaping (rename fields, derive flags, simple filters), where the result is just a transformed array consumed downstream as a whole. " +
    "If you need per-item LLM classification, do it as ONE batch llm-call whose userPrompt embeds the entire array (e.g. `Classify each item in this list and return a JSON array... Items: {{input.newItems}}`) — the strict template interpolator JSON-stringifies arrays automatically. Then text-parser the JSON array out and store. " +
    "If you genuinely need per-item fan-out into a multi-node sub-pipeline, use the sub-workflow node downstream of the loop and pass each result element via a transform. " +
    "Expression API: receives `item`, `index`, original `input`. MUST `return` a value. Output: `{ results, count }`.",
  llmExamples: [
    { arrayPath: 'items', expression: 'return { id: item.id, doubled: item.value * 2 }' },
    { arrayPath: 'data.results', expression: 'return item.title.toLowerCase()' },
    { arrayPath: 'messages', expression: 'return { ...item, isUnread: item.labels.includes("UNREAD") }' },
  ],
};
