import type { NodeDefinition } from '../types';
import { DEFAULT_NODE_MAX_TOKENS } from '$lib/constants/default-models';

export const llmAgentDef: NodeDefinition = {
  type: 'llm-agent',
  label: 'LLM Agent',
  category: 'agentic',
  description:
    'Multi-turn LLM agent that can use connected downstream nodes as tools. Loops until the LLM responds without tool calls, or hits iteration/token/timeout limits.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'LEAVE EMPTY to use the site default (configured in admin → model defaults). This is the recommended option and requires no per-workflow key management. Only set a value to explicitly override — slashed IDs like "openai/gpt-4o" route via OpenRouter and require an OpenRouter key to be configured.' },
      systemPrompt: {
        type: 'string',
        description: 'System prompt. Supports {{input.field}} templates.',
      },
      userPrompt: {
        type: 'string',
        description: 'User prompt. Supports {{input.field}} templates.',
      },
      temperature: { type: 'number', description: 'Sampling temperature 0-2 (default 0.7)' },
      maxTokens: { type: 'number', description: 'Max tokens per LLM call (default 25000). A ceiling, not a spend; requests over a model\'s advertised provider ceiling are clamped automatically. Use maxTotalTokens to bound the whole loop.' },
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
      toolSource: {
        type: 'string',
        enum: ['edges', 'site-tools'],
        description:
          'Where the agent gets its tools. "edges" (default) = every downstream connected node. "site-tools" = an allowlisted set of non-destructive registry tools (no wiring needed).',
      },
      siteToolAllowlist: {
        type: 'array',
        items: { type: 'string' },
        description:
          'REQUIRED when toolSource="site-tools": exact registry tool names the agent may call. Destructive and denylisted tools are always excluded. Never left empty (an agent is never granted all tools).',
      },
    },
    required: ['userPrompt'],
  },
  // Born on the site default model with a generous per-call ceiling — see
  // DEFAULT_NODE_MAX_TOKENS.
  defaultConfig: {
    model: '',
    systemPrompt: '',
    userPrompt: '',
    temperature: 0.7,
    maxTokens: DEFAULT_NODE_MAX_TOKENS,
    maxIterations: 10,
    maxTotalTokens: 0,
    toolSource: 'edges',
    siteToolAllowlist: [],
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
      description: 'Leave as "Default" to use the site-wide admin default (recommended). Only pick a specific model to override.',
      options: [
        { value: '', label: 'Default (site setting)' },
        { value: 'z-ai/glm-5-turbo', label: 'GLM 5 Turbo' },
        { value: 'z-ai/glm-5.2', label: 'GLM 5.2' },
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
      key: 'toolSource',
      label: 'Tool source',
      type: 'dropdown',
      section: 'TOOLS',
      description:
        'Edges = every downstream connected node becomes a tool. Site tools = an allowlist of non-destructive registry tools (no wiring needed).',
      options: [
        { value: 'edges', label: 'Connected nodes (edges)' },
        { value: 'site-tools', label: 'Site tools (allowlist)' },
      ],
    },
    {
      key: 'siteToolAllowlist',
      label: 'Allowed site tools',
      type: 'chip-input',
      section: 'TOOLS',
      description:
        'Exact registry tool names the agent may call (e.g. file_search, research_search, render_chart). Destructive/denylisted tools are always excluded.',
      visibleWhen: { key: 'toolSource', equals: 'site-tools' },
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
    'Use when the task requires multi-step reasoning with tool use. Two tool sources: (1) toolSource="edges" (default) — every downstream connected node becomes a callable tool; (2) toolSource="site-tools" — provide siteToolAllowlist (exact non-destructive registry tool names, e.g. ["file_search","research_search"]) and the agent can call them directly with no wiring. Destructive tools are NEVER exposed to an agent regardless of the allowlist; the allowlist must be non-empty. Every sub-tool call is run with a per-call timeout and its LLM cost is captured. Best for complex tasks that need planning, research, or iterative refinement.',
  llmExamples: [
    {
      // model omitted on purpose — defaults to the site admin default.
      systemPrompt: 'You are a research assistant. Use the available tools to answer questions.',
      userPrompt: '{{input.question}}',
      maxIterations: 5,
    },
    {
      systemPrompt: 'You answer questions using the user\'s uploaded files and past research.',
      userPrompt: '{{input.question}}',
      toolSource: 'site-tools',
      siteToolAllowlist: ['file_search', 'research_search'],
      maxIterations: 6,
    },
  ],
};
