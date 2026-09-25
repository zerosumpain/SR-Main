import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
import { FatalError } from '../errors';

export { llmRouterDef } from './llm-router.def';

export const llmRouterExecutor: NodeExecutor = {
  type: 'llm-router',
  async execute(input, config, context): Promise<NodeResult> {
    const routesStr = (config.routes as string) || '[]';
    let routes: { handle: string; description: string }[];
    try {
      routes = JSON.parse(routesStr);
    } catch {
      throw new FatalError('Invalid routes JSON');
    }
    if (routes.length === 0) throw new FatalError('No routes defined');

    const routeList = routes.map((r, i) => `${i + 1}. "${r.handle}" — ${r.description}`).join('\n');
    const systemPrompt = `You are a routing engine. Given input data and routes, respond with ONLY the handle name of the best matching route. No explanation, no quotes.\n\nAvailable routes:\n${routeList}`;

    const response = await resilientChatCompletion(
      config.model as string | undefined,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(input, null, 2) },
        ],
        temperature: 0.1,
        max_tokens: 50,
      },
      { signal: context.abortSignal },
    );

    const selected = (response.choices[0]?.message?.content ?? '').trim();
    const matchedRoute = routes.find((r) => r.handle === selected);
    const handle = matchedRoute ? matchedRoute.handle : routes[0].handle;

    return {
      output: { ...input, selectedRoute: handle },
      metadata: { _selectedHandle: handle, model: response.model },
      rowCount: 1,
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

