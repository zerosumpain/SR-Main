import type { NodeExecutor, NodeResult, ExecutionContext, JsonSchema } from '../types';
import { loadKeys } from '$lib/deepdive/keys';
import { interpolateTemplateStrict } from './template';
import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
import { resolveMaxTokens } from './llm-helpers';

export { openrouterDef } from './openrouter.def';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export const openrouterExecutor: NodeExecutor = {
  type: 'openrouter',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'chat_completion';

    switch (operation) {
      case 'chat_completion': {
        const configuredModel = (config.model as string)?.trim();
        const { result: systemPrompt, missingPaths: sysMissing } = interpolateTemplateStrict((config.systemPrompt as string) || '', input);
        const { result: userPrompt, missingPaths: userMissing } = interpolateTemplateStrict((config.userPrompt as string) || '', input);
        const missing = [...sysMissing, ...userMissing];
        if (missing.length > 0) {
          throw new Error(`Prompt template references unresolved: ${missing.join(', ')}. Check upstream node output.`);
        }
        const temperature = (config.temperature as number) ?? 0.7;
        const maxTokens = resolveMaxTokens(config.maxTokens);

        // Blank model → the SITE default, the same as every other LLM node
        // (this used to fall to the chat's alt-OpenRouter setting and then a
        // hardcoded openai/gpt-4o-mini, so a "default" here meant something
        // different from a "default" on an LLM call). Going through the
        // resilient gateway rather than a raw client also buys the per-call
        // timeout, the concurrency limit and model failover.
        const response = await resilientChatCompletion(
          configuredModel,
          {
            messages: [
              ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
              { role: 'user' as const, content: userPrompt },
            ],
            temperature,
            max_tokens: maxTokens,
          },
          { signal: context.abortSignal },
        );

        const content = response.choices[0]?.message?.content ?? '';
        const usage = response.usage;
        const model = response.model || configuredModel || 'default';
        return {
          output: {
            response: content,
            model: response.model,
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
          rowCount: 1,
        };
      }

      case 'list_models': {
        const keys = loadKeys();
        if (!keys.openrouterApiKey) throw new Error('OpenRouter API key not configured');
        const res = await fetch(`${OPENROUTER_BASE}/models`, {
          headers: { Authorization: `Bearer ${keys.openrouterApiKey}` },
        });
        if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
        const data = await res.json();
        const models = data.data ?? [];
        return { output: { models, count: models.length }, rowCount: 1 };
      }

      case 'get_usage': {
        const keys = loadKeys();
        if (!keys.openrouterApiKey) throw new Error('OpenRouter API key not configured');
        const res = await fetch(`${OPENROUTER_BASE}/auth/key`, {
          headers: { Authorization: `Bearer ${keys.openrouterApiKey}` },
        });
        if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
        const data = await res.json();
        return { output: { usage: data.data ?? data }, rowCount: 1 };
      }

      default:
        throw new Error(`Unknown OpenRouter operation: ${operation}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Available for template interpolation in prompts' };
  },

  getOutputSchema(config: Record<string, unknown>): JsonSchema {
    const op = (config.operation as string) || 'chat_completion';
    if (op === 'chat_completion') {
      return {
        type: 'object',
        properties: {
          response: { type: 'string', description: 'Generated text response' },
          model: { type: 'string', description: 'Model ID used' },
          usage: {
            type: 'object',
            properties: {
              promptTokens: { type: 'number' },
              completionTokens: { type: 'number' },
            },
          },
        },
      };
    }
    if (op === 'list_models') {
      return {
        type: 'object',
        properties: {
          models: { type: 'array', description: 'Array of available OpenRouter model objects' },
          count: { type: 'number', description: 'Number of models returned' },
        },
      };
    }
    // get_usage
    return {
      type: 'object',
      properties: {
        usage: { type: 'object', description: 'OpenRouter key usage and limit info' },
      },
    };
  },
};

