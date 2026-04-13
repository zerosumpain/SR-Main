import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { getOpenRouterClient, loadKeys } from '$lib/deepdive/keys';
import { interpolateTemplate } from './template';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export const openrouterExecutor: NodeExecutor = {
  type: 'openrouter',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'chat_completion';

    switch (operation) {
      case 'chat_completion': {
        const model = (config.model as string) || 'openai/gpt-4o-mini';
        const systemPrompt = interpolateTemplate((config.systemPrompt as string) || '', input);
        const userPrompt = interpolateTemplate((config.userPrompt as string) || '', input);
        const temperature = (config.temperature as number) ?? 0.7;
        const maxTokens = (config.maxTokens as number) ?? 1024;

        const client = getOpenRouterClient();
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
        return { output: { models, count: models.length } };
      }

      case 'get_usage': {
        const keys = loadKeys();
        if (!keys.openrouterApiKey) throw new Error('OpenRouter API key not configured');
        const res = await fetch(`${OPENROUTER_BASE}/auth/key`, {
          headers: { Authorization: `Bearer ${keys.openrouterApiKey}` },
        });
        if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
        const data = await res.json();
        return { output: { usage: data.data ?? data } };
      }

      default:
        throw new Error(`Unknown OpenRouter operation: ${operation}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Available for template interpolation in prompts' };
  },

  getOutputSchema(config: Record<string, unknown>) {
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

export const openrouterDef: NodeDefinition = {
  type: 'openrouter',
  label: 'OpenRouter',
  category: 'integration',
  description:
    'OpenRouter integration: chat completion with model picker, list available models, or get API usage stats.',
  configSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'chat_completion | list_models | get_usage',
      },
      model: {
        type: 'string',
        description: 'Model ID for chat_completion (e.g. openai/gpt-4o-mini)',
      },
      systemPrompt: {
        type: 'string',
        description: 'System prompt. Supports {{input.field}} templates.',
      },
      userPrompt: {
        type: 'string',
        description: 'User prompt. Supports {{input.field}} templates.',
      },
      temperature: {
        type: 'number',
        description: 'Temperature 0–2 (default 0.7)',
      },
      maxTokens: {
        type: 'number',
        description: 'Max tokens to generate (default 1024)',
      },
    },
    required: ['operation'],
  },
  defaultConfig: {
    operation: 'chat_completion',
    model: 'openai/gpt-4o-mini',
    systemPrompt: '',
    userPrompt: '',
    temperature: 0.7,
    maxTokens: 1024,
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
};
