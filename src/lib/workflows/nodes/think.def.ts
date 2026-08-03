import type { NodeDefinition } from '../types';
import { DEFAULT_NODE_MAX_TOKENS } from '$lib/constants/default-models';

export const thinkDef: NodeDefinition = {
  type: 'think', label: 'Think', category: 'agentic',
  description: 'Chain-of-thought reasoning. LLM reasons step-by-step, outputs reasoning + conclusion.',
  configSchema: { type: 'object', properties: {
    prompt: { type: 'string', description: 'What to reason about. Supports {{input.field}} templates.' },
    model: { type: 'string', description: 'LEAVE EMPTY to use the site default (configured in admin → model defaults). Only set a full OpenRouter slug to explicitly override.' },
    temperature: { type: 'number', description: 'Sampling temperature (default 0.3)' },
    maxTokens: { type: 'number', description: 'Max tokens (default 25000). A ceiling, not a spend; reasoning tokens are charged against it, and requests over a model\'s advertised provider ceiling are clamped automatically.' },
  }, required: ['prompt'] },
  // Born on the site default model with a generous ceiling — this node reasons
  // at length by design, so it is the one most hurt by a tight budget.
  defaultConfig: { prompt: '', model: '', temperature: 0.3, maxTokens: DEFAULT_NODE_MAX_TOKENS },
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
      description: 'Leave as "Default" to use the site-wide admin default (recommended). Only pick a specific model to override — prefer full OpenRouter slugs (e.g. z-ai/glm-5.2, openai/gpt-4o).',
      options: [
        { value: '', label: 'Default (site setting)' },
        { value: 'z-ai/glm-5-turbo', label: 'GLM 5 Turbo' },
        { value: 'z-ai/glm-5.1', label: 'GLM 5.1' },
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
