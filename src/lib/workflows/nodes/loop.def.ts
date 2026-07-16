import type { NodeDefinition } from '../types';

export const loopDef: NodeDefinition = {
  type: 'loop',
  label: 'Loop',
  category: 'control',
  description:
    "Iterate an array from the input. 'map' mode applies a JS expression to each item and returns { results, count } once. 'subworkflow' mode fans each item out to a saved sub-workflow (bounded concurrency) and returns per-item results — use this when each item needs real side effects.",
  configSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['map', 'subworkflow'],
        description:
          "'map' (default) = pure per-item transform via `expression`. 'subworkflow' = invoke a saved workflow per item (for per-item side effects / multi-node pipelines).",
      },
      arrayPath: {
        type: 'string',
        description: "Dot-path into input to find the array (e.g. 'items' or 'data.values')",
      },
      expression: {
        type: 'string',
        description:
          '[map mode] JS function body applied to each item. Variables: `item`, `index`, `input`. Must return a value.',
      },
      concurrency: {
        type: 'number',
        description:
          'How many items to process at once. Map mode default 1 (sequential). Subworkflow mode default 3, capped at 10. Output order always matches input order.',
      },
      subWorkflowId: {
        type: 'string',
        description:
          '[subworkflow mode] ID of the saved workflow to invoke per item. Each invocation receives input { item, index }. Cannot be this workflow (self-recursion is rejected).',
      },
      failurePolicy: {
        type: 'string',
        enum: ['continue', 'stop'],
        description:
          "[subworkflow mode] 'continue' (default) records the failure and keeps going; 'stop' halts the fan-out on the first item failure.",
      },
      maxItems: {
        type: 'number',
        description:
          '[subworkflow mode] Hard cap on how many items are processed (default 50). Extra items are truncated and logged.',
      },
    },
    required: ['arrayPath'],
  },
  defaultConfig: { mode: 'map', arrayPath: 'items', expression: 'return item' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'array', label: 'Results' }],
  basicConfig: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'dropdown',
      description: 'map = transform each item; subworkflow = invoke a saved workflow per item.',
      options: [
        { value: 'map', label: 'Map — transform each item' },
        { value: 'subworkflow', label: 'Sub-workflow — run a workflow per item' },
      ],
    },
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
      visibleWhen: { key: 'mode', not: 'subworkflow' },
    },
    {
      key: 'subWorkflowId',
      label: 'Sub-workflow ID',
      type: 'text',
      description: 'Saved workflow invoked per item with input { item, index }.',
      placeholder: 'workflow id',
      section: 'SUB-WORKFLOW',
      visibleWhen: { key: 'mode', equals: 'subworkflow' },
    },
    {
      key: 'failurePolicy',
      label: 'On item failure',
      type: 'dropdown',
      description: 'continue = record and keep going; stop = halt on the first failure.',
      options: [
        { value: 'continue', label: 'Continue' },
        { value: 'stop', label: 'Stop' },
      ],
      visibleWhen: { key: 'mode', equals: 'subworkflow' },
    },
    {
      key: 'maxItems',
      label: 'Max items',
      type: 'number',
      description: 'Hard cap on items processed (default 50). Extra items are truncated.',
      min: 1,
      visibleWhen: { key: 'mode', equals: 'subworkflow' },
    },
    {
      key: 'concurrency',
      label: 'Concurrency',
      type: 'number',
      description: 'How many items to process in parallel (map default 1, subworkflow default 3, max 10).',
      min: 1,
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
  llmDescription:
    "Iterate an array from the input. Two modes:\n" +
    "• MAP mode (default, `mode: 'map'`): applies a synchronous JS `expression` to each element and returns `{ results: [...], count: N }` exactly ONCE. Downstream nodes run once with that whole object. Use for PURE reshaping — rename fields, derive flags, simple filters — where the output is just a transformed array. For per-item LLM classification WITHOUT side effects, prefer ONE batch llm-call whose prompt embeds the whole array (`{{input.newItems}}`); it's cheaper than fan-out.\n" +
    "• SUBWORKFLOW mode (`mode: 'subworkflow'`): invokes a saved sub-workflow ONCE PER ITEM with input `{ item, index }`, with bounded concurrency. This IS the per-item fan-out primitive — use it when each item needs real SIDE EFFECTS or a multi-node pipeline (e.g. per-item: enrich → summarise → send; or write each row to a store / post each item). Config: `subWorkflowId` (a saved workflow, NOT this one — self-recursion is rejected), `arrayPath`, `concurrency` (default 3, max 10), `failurePolicy` ('continue' default records failures and keeps going, 'stop' halts on first failure), `maxItems` (default 50 hard cap; extra items truncated + logged). Output: `{ results: [{ index, status, output?, error? }], succeeded, failed, count, truncated, totalItems }`. dryRun does not invoke sub-workflows.\n" +
    "Rule of thumb: pure data reshaping ⇒ map; anything with per-item IO/side-effects ⇒ subworkflow.",
  llmExamples: [
    { mode: 'map', arrayPath: 'items', expression: 'return { id: item.id, doubled: item.value * 2 }' },
    { mode: 'map', arrayPath: 'data.results', expression: 'return item.title.toLowerCase()' },
    { mode: 'subworkflow', arrayPath: 'body.posts', subWorkflowId: '{{input.perItemWorkflowId}}', concurrency: 3, failurePolicy: 'continue', maxItems: 50 },
  ],
};
