import type { NodeDefinition, NodeExecutor, NodeResult, JsonSchema } from '../types';

/**
 * Post-it note — an inert documentation primitive. Never executes as part
 * of a workflow run (the engine skips it via `isDisplayOnlyType`), but
 * IS registered here so the orchestrator can discover it and drop sticky
 * notes on the canvas while it builds a workflow.
 */
export const postitDef: NodeDefinition = {
  type: 'postit',
  label: 'Post-it note',
  category: 'custom',
  description:
    'Inert sticky note used to leave comments, caveats, or TODOs on the canvas. Never executes. Supports a title and free-text body.',
  configSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short heading — optional.' },
      text: { type: 'string', description: 'Body text of the note.' },
      color: {
        type: 'string',
        enum: ['yellow', 'pink', 'blue', 'green'],
        description: 'Sticky colour. Yellow = default, pink = warning / TODO, blue = info, green = resolved.',
      },
      size: {
        type: 'object',
        properties: {
          w: { type: 'number' },
          h: { type: 'number' },
        },
      },
    },
  },
  defaultConfig: { title: '', text: '', color: 'yellow', size: { w: 220, h: 180 } },
  inputs: [],
  outputs: [],
  basicConfig: [
    {
      key: 'title',
      label: 'Title',
      type: 'text',
      placeholder: 'TODO',
    },
    {
      key: 'text',
      label: 'Body',
      type: 'textarea',
      placeholder: 'Write a comment…',
    },
    {
      key: 'color',
      label: 'Colour',
      type: 'dropdown',
      options: [
        { value: 'yellow', label: 'Yellow (default)' },
        { value: 'pink', label: 'Pink (warning / TODO)' },
        { value: 'blue', label: 'Blue (info)' },
        { value: 'green', label: 'Green (resolved)' },
      ],
    },
  ],
  llmDescription:
    'Use post-it notes to annotate a workflow while you build it. Drop them near the nodes they describe. Good uses: explaining a non-obvious config choice, flagging a TODO, warning about a cost / rate-limit hazard, or leaving a human-readable summary of what a branch does. Keep the body to 1–3 short sentences. Pick colour by intent: yellow = informational, pink = TODO or warning, blue = context, green = resolved / known-good. Do NOT wire edges to or from a post-it note — it is decoration only.',
  llmExamples: [
    { title: 'Cost watch', text: 'This branch calls GPT-4 per item — watch the cost meter.', color: 'pink' },
    { title: 'Why JSON?', text: 'Downstream validator expects strict JSON; keep the llm-call response_format set.', color: 'blue' },
  ],
};

export const postitExecutor: NodeExecutor = {
  type: 'postit',
  async execute(): Promise<NodeResult> {
    // Display-only; the engine filters this type out before execution.
    return { output: {} };
  },
  getInputSchema(): JsonSchema {
    return { type: 'object' };
  },
  getOutputSchema(): JsonSchema {
    return { type: 'object' };
  },
};
