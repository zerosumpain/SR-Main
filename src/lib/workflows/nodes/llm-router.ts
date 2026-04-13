import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { getOpenRouterClient } from '$lib/deepdive/keys';

export const llmRouterExecutor: NodeExecutor = {
  type: 'llm-router',
  async execute(input, config, _context): Promise<NodeResult> {
    const model = (config.model as string) || 'openai/gpt-4o-mini';
    const routesStr = (config.routes as string) || '[]';
    let routes: { handle: string; description: string }[];
    try {
      routes = JSON.parse(routesStr);
    } catch {
      return { output: { ...input, error: 'Invalid routes JSON' } };
    }
    if (routes.length === 0) return { output: { ...input, error: 'No routes defined' } };

    const routeList = routes.map((r, i) => `${i + 1}. "${r.handle}" — ${r.description}`).join('\n');
    const systemPrompt = `You are a routing engine. Given input data and routes, respond with ONLY the handle name of the best matching route. No explanation, no quotes.\n\nAvailable routes:\n${routeList}`;

    const client = getOpenRouterClient();
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(input, null, 2) },
      ],
      temperature: 0.1,
      max_tokens: 50,
    });

    const selected = (response.choices[0]?.message?.content ?? '').trim();
    const matchedRoute = routes.find((r) => r.handle === selected);
    const handle = matchedRoute ? matchedRoute.handle : routes[0].handle;

    return {
      output: { ...input, selectedRoute: handle },
      metadata: { _selectedHandle: handle, model },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Data the LLM uses to decide routing' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: { selectedRoute: { type: 'string', description: 'The chosen route handle' } },
    };
  },
};

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
      model: { type: 'string', description: 'OpenRouter model ID' },
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
    model: 'openai/gpt-4o-mini',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'route_a', type: 'any', label: 'Route A' },
    { name: 'route_b', type: 'any', label: 'Route B' },
  ],
  basicConfig: [
    {
      key: 'routes',
      label: 'Routes (JSON)',
      type: 'textarea',
      description: 'Array of { "handle": "name", "description": "when to use" }',
    },
    {
      key: 'model',
      label: 'Model',
      type: 'dropdown',
      options: [
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (fast)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o' },
        { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku (fast)' },
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
      model: 'openai/gpt-4o-mini',
    },
  ],
};
