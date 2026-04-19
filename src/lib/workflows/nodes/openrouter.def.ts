import type { NodeDefinition } from '../types';

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
    model: '',
    systemPrompt: '',
    userPrompt: '',
    temperature: 0.7,
    maxTokens: 1024,
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Action', type: 'dropdown',
      description: 'What to do with OpenRouter',
      options: [
        { value: 'chat_completion', label: 'Chat Completion' },
        { value: 'list_models', label: 'List Models' },
        { value: 'get_usage', label: 'Get API Usage' },
      ],
    },
    {
      key: 'model', label: 'Model', type: 'dropdown',
      description: 'Which LLM runs this step. Leave as default to use the admin-configured OpenRouter alt model.',
      options: [
        { value: '', label: 'Default (use admin alt OpenRouter model)' },
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
        { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (smart)' },
        { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4 (very fast)' },
        { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      ],
      visibleWhen: { key: 'operation', equals: 'chat_completion' },
    },
    {
      key: 'systemPrompt', label: 'System Prompt', type: 'template-textarea',
      section: 'PROMPT',
      placeholder: 'You are a helpful assistant...',
      description: 'Instructions that set behaviour/persona. Supports {{input.field}} templates.',
      visibleWhen: { key: 'operation', equals: 'chat_completion' },
    },
    {
      key: 'userPrompt', label: 'User Prompt', type: 'template-textarea',
      placeholder: 'Summarise {{input.text}} in 3 bullets.',
      description: 'The user message. Supports {{input.field}} templates.',
      visibleWhen: { key: 'operation', equals: 'chat_completion' },
    },
    {
      key: 'temperature', label: 'Creativity (temperature)', type: 'slider',
      min: 0, max: 2, step: 0.1,
      description: '0 = deterministic, 1 = balanced, 2 = very creative',
      visibleWhen: { key: 'operation', equals: 'chat_completion' },
    },
    {
      key: 'maxTokens', label: 'Max Tokens', type: 'number', min: 1,
      description: 'Upper limit on response length',
      advancedOnly: true,
      visibleWhen: { key: 'operation', equals: 'chat_completion' },
    },
  ],
};
