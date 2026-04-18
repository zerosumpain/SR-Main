import type OpenAI from 'openai';
import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getOpenRouterClient } from '$lib/deepdive/keys';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';

export { llmCallDef } from './llm-call.def';

export const llmCallExecutor: NodeExecutor = {
  type: 'llm-call',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const configuredModel = (config.model as string)?.trim();
    const systemPrompt = interpolateTemplate((config.systemPrompt as string) || '', input);
    const userPrompt = interpolateTemplate((config.userPrompt as string) || '', input);
    const temperature = (config.temperature as number) ?? 0.7;
    const maxTokens = (config.maxTokens as number) ?? 1024;

    // When no model is configured, fall back to the same default jkai uses
    // (chat default — routed via the correct provider client). When a model
    // string is configured, it's treated as an OpenRouter modelId to preserve
    // backwards compatibility with existing nodes.
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
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const usage = response.usage;

    return {
      output: {
        response: content,
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
        },
      },
      metadata: {
        model,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available for template interpolation in prompts' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'LLM response text' },
        usage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'number' },
            completionTokens: { type: 'number' },
          },
        },
      },
    };
  },
};

