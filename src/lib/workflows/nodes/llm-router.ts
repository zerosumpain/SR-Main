import type OpenAI from 'openai';
import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { getOpenRouterClient } from '$lib/deepdive/keys';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';

export { llmRouterDef } from './llm-router.def';

export const llmRouterExecutor: NodeExecutor = {
  type: 'llm-router',
  async execute(input, config, _context): Promise<NodeResult> {
    const configuredModel = (config.model as string)?.trim();
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

    let client: OpenAI;
    let model: string;
    if (configuredModel) {
      client = getOpenRouterClient();
      model = configuredModel;
    } else {
      const ctx = await resolveDefaultModel('chat');
      const resolved = await getLLMClient(ctx);
      client = resolved.client;
      model = resolved.model;
    }

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

