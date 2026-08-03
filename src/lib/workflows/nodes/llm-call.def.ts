import type { NodeDefinition } from '../types';
import { DEFAULT_NODE_MAX_TOKENS } from '$lib/constants/default-models';

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
      maxTokens: { type: 'number', description: 'Max tokens to generate (default 25000). This is a CEILING, not a spend — leave it alone unless you specifically want to cut a response short. Note: reasoning-heavy models (GLM, DeepSeek V4, o1, etc.) charge reasoning tokens against this cap, so values below ~1000 frequently return empty content with finish_reason=length. Requests over a model\'s advertised provider ceiling are clamped automatically.' },
      outputSchema: { type: 'object', description: 'Optional JSON Schema. When set, the node requests a JSON response, parses it, validates that top-level `required` keys are present, retries once on failure, and returns the parsed object under `data` (raw text still on `response`). Use for reliable data extraction.' },
    },
    required: ['userPrompt'],
  },
  // A new node is born on the site default model (model: '' resolves through
  // resolveLLMClient at run time, so it keeps tracking the /jkai picker) with a
  // deliberately generous ceiling — see DEFAULT_NODE_MAX_TOKENS.
  defaultConfig: { model: '', systemPrompt: '', userPrompt: '', temperature: 0.7, maxTokens: DEFAULT_NODE_MAX_TOKENS },
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
        { value: 'z-ai/glm-5-turbo', label: 'GLM 5 Turbo' },
        { value: 'z-ai/glm-5.2', label: 'GLM 5.2' },
        { value: 'z-ai/glm-5.1', label: 'GLM 5.1' },
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
    {
      key: 'outputSchema',
      label: 'Output JSON schema (optional)',
      type: 'code',
      language: 'json',
      description: 'Set to force a structured JSON response. The parsed object is returned under `data`; top-level `required` keys are validated with one retry.',
      section: 'ADVANCED',
      advancedOnly: true,
      cheatsheet: [
        'Leave blank for a normal text reply.',
        'Example: { "type": "object", "properties": { "sentiment": { "type": "string" }, "score": { "type": "number" } }, "required": ["sentiment", "score"] }',
      ],
    },
  ],
  llmDescription: `Call an LLM with a system + user prompt. Both prompts support {{input.field}} templates. Leave \`model\` empty to use the site default (recommended); a slashed id like "openai/gpt-4o" routes via OpenRouter.

Two modes:
1. TEXT (default): returns the model's reply as a string on \`response\`. Downstream nodes read \`{{input.response}}\`.
2. STRUCTURED: set \`outputSchema\` to a JSON Schema. The node requests a JSON object, parses it, validates that the schema's top-level \`required\` keys are present, retries ONCE with the error appended, then fails into On-failure. The parsed object is returned on \`data\` (read \`{{input.data.field}}\`); the raw JSON string stays on \`response\`. Use this for reliable extraction/classification instead of parsing prose downstream.

Reasoning models (GLM) burn reasoning tokens from max_tokens — in structured mode the node auto-raises the budget to ≥3000 for GLM models.`,
  llmExamples: [
    { userPrompt: 'Summarise this in one sentence: {{input.text}}' },
    {
      systemPrompt: 'You are a precise data extractor.',
      userPrompt: 'Classify the sentiment of: {{input.review}}',
      outputSchema: { type: 'object', properties: { sentiment: { type: 'string' }, score: { type: 'number' } }, required: ['sentiment', 'score'] },
    },
  ],
};
