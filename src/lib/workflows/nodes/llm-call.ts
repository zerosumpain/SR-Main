import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getOpenRouterClient } from '$lib/deepdive/keys';

export const llmCallExecutor: NodeExecutor = {
  type: 'llm-call',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
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

export const llmCallDef: NodeDefinition = {
  type: 'llm-call',
  label: 'LLM Call',
  category: 'core',
  description: 'Call an LLM via OpenRouter. System and user prompts support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'OpenRouter model ID, e.g. openai/gpt-4o-mini' },
      systemPrompt: { type: 'string', description: 'System prompt. Supports {{input.field}} templates.' },
      userPrompt: { type: 'string', description: 'User prompt. Supports {{input.field}} templates.' },
      temperature: { type: 'number', description: 'Sampling temperature 0–2 (default 0.7)' },
      maxTokens: { type: 'number', description: 'Max tokens to generate (default 1024)' },
    },
    required: ['userPrompt'],
  },
  defaultConfig: { model: 'openai/gpt-4o-mini', systemPrompt: '', userPrompt: '', temperature: 0.7, maxTokens: 1024 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Response' }],
};
