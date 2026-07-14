import type { NodeDefinition } from '../types';

export const thinkDef: NodeDefinition = {
  type: 'think', label: 'Think', category: 'agentic',
  description: 'Chain-of-thought reasoning. LLM reasons step-by-step, outputs reasoning + conclusion.',
  configSchema: { type: 'object', properties: {
    prompt: { type: 'string', description: 'What to reason about. Supports {{input.field}} templates.' },
    model: { type: 'string', description: 'OpenRouter model ID' },
    temperature: { type: 'number', description: 'Sampling temperature (default 0.3)' },
    maxTokens: { type: 'number', description: 'Max tokens (default 2048)' },
  }, required: ['prompt'] },
  defaultConfig: { prompt: '', model: '', temperature: 0.3, maxTokens: 2048 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Reasoning' }],
  basicConfig: [
    {
      key: 'prompt',
      label: 'Reasoning Task',
      type: 'template-textarea',
      placeholder: 'Analyze the data and determine the best course of action.',
      description: 'What you want the LLM to think about. Use {{input.field}} to reference incoming data.',
    },
    {
      key: 'model',
      label: 'Model',
      type: 'dropdown',
      description: 'Which LLM runs this step. Bare IDs route to the jkai default provider (Z.AI). Slashed IDs go via OpenRouter.',
      options: [
        { value: 'glm-5-turbo', label: 'GLM 5 Turbo — Z.AI (jkai default)' },
        { value: 'glm-5.1', label: 'GLM 5.1 — Z.AI' },
        { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
        { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (smart)' },
        { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4 (very fast)' },
        { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      ],
    },
    {
      key: 'temperature',
      label: 'Temperature',
      type: 'slider',
      min: 0,
      max: 2,
      step: 0.1,
      description: 'Lower = more focused, higher = more creative',
    },
    {
      key: 'maxTokens',
      label: 'Max Tokens',
      type: 'number',
      advancedOnly: true,
      description: 'Maximum length of the LLM response',
    },
  ],
  llmDescription: 'Use when the workflow needs careful deliberation before a decision. Place before Conditional or Router nodes so decisions are informed by explicit reasoning.',
  llmExamples: [{ prompt: 'Analyze the health data and determine if the user should be alerted.', model: 'openai/gpt-4o', temperature: 0.2 }],
};
