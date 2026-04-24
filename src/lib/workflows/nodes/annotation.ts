import type { NodeDefinition, NodeExecutor, NodeResult, JsonSchema } from '../types';

/**
 * Annotation box — an inert documentation primitive. It never executes as
 * part of a workflow run (the engine skips it via `isDisplayOnlyType`),
 * but it IS registered here so the orchestrator can discover it and place
 * one on the canvas to document regions, group related nodes, or call
 * out sections while it builds a workflow.
 */
export const annotationDef: NodeDefinition = {
  type: 'annotation',
  label: 'Annotation box',
  category: 'custom',
  description:
    'Inert dashed rectangle used to visually group or document a region of the canvas. Never executes. Carries an optional title — use it to name the area (e.g. "Ingestion", "Retry loop", "TODO").',
  configSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short label shown on the top edge of the box.' },
      size: {
        type: 'object',
        properties: {
          w: { type: 'number' },
          h: { type: 'number' },
        },
        description: 'Box dimensions in pixels.',
      },
    },
  },
  defaultConfig: { title: '', size: { w: 360, h: 220 } },
  inputs: [],
  outputs: [],
  basicConfig: [
    {
      key: 'title',
      label: 'Title',
      type: 'text',
      description: 'Optional short label shown on the top edge.',
      placeholder: 'Ingestion',
    },
  ],
  llmDescription:
    'When building a workflow, drop one or more annotation boxes on the canvas to document its structure. Position the box so it wraps a group of related nodes (use x/y/w/h so the box fully encloses them), and set a short, descriptive title. Good titles are nouns or noun phrases that name the subsystem — "Ingestion", "Enrichment", "Error handling", "Fallback path". Do NOT wire edges to or from an annotation box — it is decoration only.',
  llmExamples: [
    { title: 'Ingestion', size: { w: 480, h: 260 } },
    { title: 'Retry loop', size: { w: 320, h: 200 } },
  ],
};

export const annotationExecutor: NodeExecutor = {
  type: 'annotation',
  async execute(): Promise<NodeResult> {
    // Display-only; the engine filters this type out before execution.
    // Returning an empty result if it's ever reached keeps the run alive.
    return { output: {} };
  },
  getInputSchema(): JsonSchema {
    return { type: 'object' };
  },
  getOutputSchema(): JsonSchema {
    return { type: 'object' };
  },
};
