import type OpenAI from 'openai';
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getOpenRouterClient } from '$lib/deepdive/keys';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';

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

export const llmCallDef: NodeDefinition = {
  type: 'llm-call',
  label: 'LLM Call',
  category: 'core',
  description: 'Call an LLM. Leave the model empty to use the same default as jkai (configured in admin → model defaults). Set an OpenRouter model ID to override. System and user prompts support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'Optional OpenRouter model ID (e.g. openai/gpt-4o-mini). Leave empty to use the jkai chat default, configured in admin.' },
      systemPrompt: { type: 'string', description: 'System prompt. Supports {{input.field}} templates.' },
      userPrompt: { type: 'string', description: 'User prompt. Supports {{input.field}} templates.' },
      temperature: { type: 'number', description: 'Sampling temperature 0–2 (default 0.7)' },
      maxTokens: { type: 'number', description: 'Max tokens to generate (default 1024)' },
    },
    required: ['userPrompt'],
  },
  defaultConfig: { model: '', systemPrompt: '', userPrompt: '', temperature: 0.7, maxTokens: 1024 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Response' }],
  basicConfig: [
    {
      key: 'userPrompt',
      label: 'User Prompt',
      type: 'template-textarea',
      description: 'What you want the AI to do. Use {{input.field}} to insert upstream data.',
      placeholder: 'Summarise this text: {{input.text}}',
      section: 'PROMPT',
    },
    {
      key: 'systemPrompt',
      label: 'System Prompt',
      type: 'template-textarea',
      description: 'Optional instructions that set the AI\'s role or style.',
      placeholder: 'You are a helpful assistant that writes concise summaries.',
      section: 'PROMPT',
    },
    {
      key: 'model',
      label: 'Model',
      type: 'dropdown',
      description: 'Which LLM answers this step. Leave as default unless you need a specific one.',
      options: [
        { value: '', label: 'Default (use jkai default model)' },
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
        { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
        { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (fast)' },
        { value: 'google/gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash' },
        { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
      ],
    },
    {
      key: 'temperature',
      label: 'Temperature',
      type: 'slider',
      description: 'How creative the answers are. 0 is focused and deterministic, 2 is wild.',
      min: 0,
      max: 2,
      step: 0.1,
    },
    {
      key: 'maxTokens',
      label: 'Max Tokens',
      type: 'number',
      description: 'Maximum length of the AI response (roughly 4 characters per token).',
      min: 1,
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
};
