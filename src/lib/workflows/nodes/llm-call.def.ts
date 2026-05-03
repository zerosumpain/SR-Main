import type { NodeDefinition } from '../types';

export const llmCallDef: NodeDefinition = {
  type: 'llm-call',
  label: 'LLM Call',
  category: 'core',
  description: 'Call an LLM. Leave the model empty to use the same default as jkai (configured in admin → model defaults). Set an OpenRouter model ID to override. System and user prompts support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'LEAVE EMPTY to use the site default (configured in admin → model defaults). This is the recommended option and requires no per-workflow key management. Only set a value to explicitly override — slashed IDs like "openai/gpt-4o" route via OpenRouter and require an OpenRouter key to be configured.' },
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
      description: 'Leave as "Default" to use the site-wide admin default (recommended). The picker shows the full live OpenRouter catalogue.',
      // Note: the canvas renders this node via LlmCallPanel.svelte (custom),
      // not BasicConfigForm — so the actual model picker lives in that panel
      // and uses fetchAllChatModels(). The options below are kept for the
      // orchestrator + admin /tools listing.
      options: [
        { value: '', label: 'Default (site setting)' },
        { value: 'glm-5-turbo', label: 'GLM 5 Turbo — Z.AI (direct)' },
        { value: 'glm-5.1', label: 'GLM 5.1 — Z.AI (direct)' },
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
