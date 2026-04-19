import type { NodeDefinition } from '../types';

export const llmAgentDef: NodeDefinition = {
  type: 'llm-agent',
  label: 'LLM Agent',
  category: 'agentic',
  description:
    'Multi-turn LLM agent that can use connected downstream nodes as tools. Loops until the LLM responds without tool calls, or hits iteration/token/timeout limits.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'OpenRouter model ID (default: openai/gpt-4o)' },
      systemPrompt: {
        type: 'string',
        description: 'System prompt. Supports {{input.field}} templates.',
      },
      userPrompt: {
        type: 'string',
        description: 'User prompt. Supports {{input.field}} templates.',
      },
      temperature: { type: 'number', description: 'Sampling temperature 0-2 (default 0.7)' },
      maxTokens: { type: 'number', description: 'Max tokens per LLM call (default 2048)' },
      maxIterations: {
        type: 'number',
        description: 'Max tool-use loop iterations (default 10)',
      },
      maxTotalTokens: {
        type: 'number',
        description: 'Total token budget across all iterations (0 = unlimited)',
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in milliseconds (0 = disabled)',
      },
      toolOverrides: {
        type: 'string',
        description:
          'JSON object mapping node IDs to { name?, description? } overrides for tool definitions',
      },
    },
    required: ['userPrompt'],
  },
  defaultConfig: {
    model: 'glm-5-turbo',
    systemPrompt: '',
    userPrompt: '',
    temperature: 0.7,
    maxTokens: 2048,
    maxIterations: 10,
    maxTotalTokens: 0,
    timeoutMs: 0,
    toolOverrides: '{}',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Agent Result' }],
  basicConfig: [
    {
      key: 'userPrompt',
      label: 'User Prompt',
      type: 'template-textarea',
      placeholder: '{{input.query}}',
      description: 'The main instruction for the agent. Use {{input.field}} to reference incoming data.',
    },
    {
      key: 'systemPrompt',
      label: 'System Prompt',
      type: 'template-textarea',
      placeholder: 'You are a helpful assistant...',
      description: 'Sets the agent\'s role and behaviour. Supports {{input.field}} templates.',
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
      section: 'ADVANCED',
      description: 'Maximum length of each LLM response',
    },
    {
      key: 'maxIterations',
      label: 'Max Iterations',
      type: 'number',
      advancedOnly: true,
      section: 'ADVANCED',
      description: 'Max tool-use loop iterations',
    },
    {
      key: 'maxTotalTokens',
      label: 'Max Total Tokens',
      type: 'number',
      advancedOnly: true,
      section: 'ADVANCED',
      description: 'Total token budget across all iterations (0 = unlimited)',
    },
    {
      key: 'timeoutMs',
      label: 'Timeout (ms)',
      type: 'number',
      advancedOnly: true,
      section: 'ADVANCED',
      description: 'Max execution time in milliseconds (0 = disabled)',
    },
    {
      key: 'toolOverrides',
      label: 'Tool Overrides',
      type: 'textarea',
      advancedOnly: true,
      section: 'ADVANCED',
      description:
        'JSON object mapping node IDs to { name?, description? } to override tool definitions.',
    },
  ],
  llmDescription:
    'Use when the task requires multi-step reasoning with tool use. The agent can call connected nodes as tools in a loop until it has the answer. Best for complex tasks that need planning, research, or iterative refinement.',
  llmExamples: [
    {
      model: 'openai/gpt-4o',
      systemPrompt: 'You are a research assistant. Use the available tools to answer questions.',
      userPrompt: '{{input.question}}',
      maxIterations: 5,
    },
  ],
};
