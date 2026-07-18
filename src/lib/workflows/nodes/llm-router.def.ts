import type { NodeDefinition } from '../types';

export const llmRouterDef: NodeDefinition = {
  type: 'llm-router',
  label: 'LLM Router',
  category: 'agentic',
  description:
    'LLM-powered semantic routing. Defines named output paths; the LLM picks which to follow.',
  configSchema: {
    type: 'object',
    properties: {
      routes: { type: 'string', description: 'JSON array of { handle, description }' },
      model: { type: 'string', description: 'LEAVE EMPTY to use the site default (configured in admin → model defaults). This is the recommended option and requires no per-workflow key management. Only set a value to explicitly override.' },
    },
    required: ['routes'],
  },
  defaultConfig: {
    routes: JSON.stringify(
      [
        { handle: 'route_a', description: 'First option' },
        { handle: 'route_b', description: 'Second option' },
      ],
      null,
      2,
    ),
    model: '',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'route_a', type: 'any', label: 'Route A' },
    { name: 'route_b', type: 'any', label: 'Route B' },
  ],
  basicConfig: [
    {
      key: 'routes',
      label: 'Routes',
      type: 'textarea',
      description:
        'List of possible routes as JSON. Each entry needs `handle` (matches source handle on this node) and `description` (when to pick it).',
    },
    {
      key: 'model',
      label: 'Model',
      type: 'dropdown',
      description: 'Leave as "Default" to use the site-wide admin default (recommended). Only pick a specific model to override.',
      options: [
        { value: '', label: 'Default (site setting)' },
        { value: 'z-ai/glm-5-turbo', label: 'GLM 5 Turbo' },
        { value: 'z-ai/glm-5.2', label: 'GLM 5.2' },
        { value: 'z-ai/glm-5.1', label: 'GLM 5.1' },
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
        { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (smart)' },
        { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4 (very fast)' },
        { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      ],
    },
  ],
  llmDescription:
    'Use for semantic decisions — choosing paths based on meaning rather than booleans. More flexible than Conditional for nuanced routing.',
  llmExamples: [
    {
      routes: JSON.stringify([
        { handle: 'positive', description: 'Positive sentiment' },
        { handle: 'negative', description: 'Negative sentiment' },
        { handle: 'neutral', description: 'Neutral or informational' },
      ]),
      // model omitted on purpose — defaults to the site admin default.
    },
  ],
};
