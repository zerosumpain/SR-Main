/**
 * Client-safe registry module with definitions only (no executors).
 * Does NOT import engine, events, or sandbox (Node.js-only modules).
 * Use this from page components. Use '$lib/workflows' from +server.ts routes.
 */
import { manualTriggerDef } from './nodes/manual-trigger';
import { transformDef } from './nodes/transform';
import { delayDef } from './nodes/delay';
import { httpRequestDef } from './nodes/http-request';
import { conditionalDef } from './nodes/conditional';
import { textParserDef } from './nodes/text-parser';
import { validatorDef } from './nodes/validator';
import { mergeDef } from './nodes/merge';
import { accumulatorDef } from './nodes/accumulator';
import { subWorkflowDef } from './nodes/sub-workflow';
import type { NodeDefinition } from './types';
// Dynamic node definitions are loaded server-side only (in index.ts).
// This file must stay client-safe — no Node.js imports (fs, path, etc).

// Code execute definition without importing the executor (which pulls in sandbox)
const codeExecuteDef: NodeDefinition = {
  type: 'code-execute',
  label: 'Code Execute',
  category: 'core',
  description: 'Run JavaScript, Python, or Bash code in a sandboxed environment.',
  configSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Language: javascript, python, or bash',
      },
      code: {
        type: 'string',
        description: 'Code to execute. Input data is available as `input` variable.',
      },
      outputSchema: {
        type: 'object',
        description: 'Optional: declare the output shape so downstream nodes get autocomplete. e.g. { "score": { "type": "number" }, "label": { "type": "string" } }',
      },
    },
    required: ['code'],
  },
  defaultConfig: { language: 'javascript', code: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    { key: 'language', label: 'Language', type: 'dropdown', options: [
      { value: 'javascript', label: 'JavaScript' }, { value: 'python', label: 'Python' }, { value: 'bash', label: 'Bash' },
    ]},
    { key: 'code', label: 'Code', type: 'code', placeholder: '// input object is available\nconsole.log(JSON.stringify({ result: input.value * 2 }))' },
    { key: 'outputSchema', label: 'Output Schema (optional)', type: 'textarea', advancedOnly: true, description: 'Declare output shape as JSON Schema for downstream autocomplete' },
  ],
};

// LLM Call definition without importing the executor (which pulls in Node.js-only modules via $lib/deepdive/keys)
const llmCallDef: NodeDefinition = {
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
  basicConfig: [
    { key: 'model', label: 'Model', type: 'dropdown', options: [
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet' },
      { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku' },
      { value: 'google/gemini-2.5-flash-preview', label: 'Gemini Flash' },
      { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    ]},
    { key: 'systemPrompt', label: 'System Prompt', type: 'template-textarea', placeholder: 'You are a helpful assistant...' },
    { key: 'userPrompt', label: 'User Prompt', type: 'template-textarea', placeholder: 'Use {{input.field}} for variables' },
    { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 2, step: 0.1 },
    { key: 'maxTokens', label: 'Max Tokens', type: 'number', advancedOnly: true },
  ],
};

// Data Store definition without importing the executor (which pulls in $lib/db — server-only)
const dataStoreDef: NodeDefinition = {
  type: 'data-store',
  label: 'Data Store',
  category: 'core',
  description: 'Read or write a value in the workflow-scoped key-value store. Persists across runs.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: "'get' or 'set'" },
      key: { type: 'string', description: 'Key name. Supports {{input.field}} templates.' },
      valuePath: {
        type: 'string',
        description: 'Dot-path into input to extract the value to store (set only). Defaults to input.value or whole input.',
      },
    },
    required: ['operation', 'key'],
  },
  defaultConfig: { operation: 'get', key: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'get', label: 'Get Value' }, { value: 'set', label: 'Set Value' },
    ]},
    { key: 'key', label: 'Key', type: 'template-textarea', placeholder: 'my-key' },
    { key: 'valuePath', label: 'Value Path (set only)', type: 'template-textarea', placeholder: 'input.value' },
  ],
};

// Email definition without importing the executor (which pulls in nodemailer + $env/dynamic/private)
const emailDef: NodeDefinition = {
  type: 'email',
  label: 'Email',
  category: 'integration',
  description: 'Send an email via SMTP. To, subject, and body support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient address. Supports {{input.field}} templates.' },
      subject: { type: 'string', description: 'Email subject. Supports templates.' },
      body: { type: 'string', description: 'Email body. HTML if it starts with <. Supports templates.' },
      from: { type: 'string', description: 'Sender override (default: SMTP_FROM env var)' },
    },
    required: ['to', 'subject', 'body'],
  },
  defaultConfig: { to: '', subject: '', body: '', from: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'to', label: 'To', type: 'template-textarea', placeholder: '{{input.email}}' },
    { key: 'subject', label: 'Subject', type: 'template-textarea' },
    { key: 'body', label: 'Body', type: 'template-textarea' },
    { key: 'from', label: 'From (override)', type: 'text', advancedOnly: true },
  ],
};

const loopDef: NodeDefinition = {
  type: 'loop',
  label: 'Loop',
  category: 'control',
  description:
    'Iterate over an array in the input and apply an expression to each item. Returns results array.',
  configSchema: {
    type: 'object',
    properties: {
      arrayPath: {
        type: 'string',
        description: "Dot-path into input to find the array (e.g. 'items' or 'data.values')",
      },
      expression: {
        type: 'string',
        description:
          'JS function body applied to each item. Variables: `item`, `index`, `input`. Must return a value.',
      },
      concurrency: {
        type: 'number',
        description: 'Concurrency limit (default 1; reserved for future use)',
      },
    },
    required: ['arrayPath'],
  },
  defaultConfig: { arrayPath: 'items', expression: 'return item', concurrency: 1 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'array', label: 'Results' }],
  basicConfig: [
    { key: 'arrayPath', label: 'Array Field', type: 'template-textarea', placeholder: 'items', description: 'Dot-path to the array in input data' },
    { key: 'expression', label: 'Item Transform', type: 'code', placeholder: 'return item' },
    { key: 'concurrency', label: 'Concurrency', type: 'number', advancedOnly: true },
  ],
};

// Strava definition without importing the executor (which pulls in $lib/health/* — server-only)
const stravaDef: NodeDefinition = {
  type: 'strava',
  label: 'Strava',
  category: 'integration',
  description: 'Access Strava activity data. Requires Strava connected in Health settings.',
  configSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'list_activities | get_activity | get_athlete_stats',
      },
      page: { type: 'number', description: 'Page number for list_activities (default 1)' },
      perPage: { type: 'number', description: 'Results per page for list_activities (default 30, max 200)' },
      activityId: { type: 'string', description: 'Activity ID for get_activity' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list_activities', page: 1, perPage: 30 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'list_activities', label: 'List Activities' },
      { value: 'get_activity', label: 'Get Activity' },
      { value: 'get_athlete_stats', label: 'Get Athlete Stats' },
    ]},
    { key: 'perPage', label: 'Results per Page', type: 'number' },
    { key: 'activityId', label: 'Activity ID', type: 'template-textarea', advancedOnly: true },
    { key: 'page', label: 'Page Number', type: 'number', advancedOnly: true },
  ],
};

// Whoop definition without importing the executor (which pulls in $lib/health/* — server-only)
const whoopDef: NodeDefinition = {
  type: 'whoop',
  label: 'Whoop',
  category: 'integration',
  description: 'Access Whoop health data. Requires Whoop connected in Health settings.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'get_cycles | get_recovery | get_sleep | get_workouts' },
      limit: { type: 'number', description: 'Max records to return (default 10)' },
      start: { type: 'string', description: 'ISO 8601 start date filter (optional)' },
      end: { type: 'string', description: 'ISO 8601 end date filter (optional)' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'get_cycles', limit: 10 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'get_cycles', label: 'Get Cycles' }, { value: 'get_recovery', label: 'Get Recovery' },
      { value: 'get_sleep', label: 'Get Sleep' }, { value: 'get_workouts', label: 'Get Workouts' },
    ]},
    { key: 'limit', label: 'Max Records', type: 'number' },
    { key: 'start', label: 'Start Date', type: 'text', advancedOnly: true, placeholder: '2025-01-01T00:00:00Z' },
    { key: 'end', label: 'End Date', type: 'text', advancedOnly: true, placeholder: '2025-12-31T23:59:59Z' },
  ],
};

const errorHandlerDef: NodeDefinition = {
  type: 'error-handler',
  label: 'Error Handler',
  category: 'control',
  description:
    'Routes to success or error output based on whether input contains an error field.',
  configSchema: {
    type: 'object',
    properties: {},
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'success', type: 'any', label: 'Success' },
    { name: 'error', type: 'any', label: 'Error' },
  ],
};

// OpenRouter definition without importing the executor (which pulls in $lib/deepdive/keys — server-only)
const openrouterDef: NodeDefinition = {
  type: 'openrouter',
  label: 'OpenRouter',
  category: 'integration',
  description:
    'OpenRouter integration: chat completion with model picker, list available models, or get API usage stats.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'chat_completion | list_models | get_usage' },
      model: { type: 'string', description: 'Model ID for chat_completion (e.g. openai/gpt-4o-mini)' },
      systemPrompt: { type: 'string', description: 'System prompt. Supports {{input.field}} templates.' },
      userPrompt: { type: 'string', description: 'User prompt. Supports {{input.field}} templates.' },
      temperature: { type: 'number', description: 'Temperature 0–2 (default 0.7)' },
      maxTokens: { type: 'number', description: 'Max tokens to generate (default 1024)' },
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
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'chat_completion', label: 'Chat Completion' },
      { value: 'list_models', label: 'List Models' },
      { value: 'get_usage', label: 'Get Usage' },
    ]},
    { key: 'model', label: 'Model', type: 'dropdown', options: [
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet' },
      { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku' },
    ]},
    { key: 'systemPrompt', label: 'System Prompt', type: 'template-textarea' },
    { key: 'userPrompt', label: 'User Prompt', type: 'template-textarea' },
    { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 2, step: 0.1, advancedOnly: true },
    { key: 'maxTokens', label: 'Max Tokens', type: 'number', advancedOnly: true },
  ],
};

// Think definition without importing the executor (which pulls in $lib/deepdive/keys — server-only)
const thinkDef: NodeDefinition = {
  type: 'think',
  label: 'Think',
  category: 'agentic',
  description: 'Chain-of-thought reasoning. LLM reasons step-by-step, outputs reasoning + conclusion.',
  configSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What to reason about. Supports {{input.field}} templates.' },
      model: { type: 'string', description: 'OpenRouter model ID' },
      temperature: { type: 'number', description: 'Sampling temperature (default 0.3)' },
      maxTokens: { type: 'number', description: 'Max tokens (default 2048)' },
    },
    required: ['prompt'],
  },
  defaultConfig: { prompt: '', model: 'openai/gpt-4o-mini', temperature: 0.3, maxTokens: 2048 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Reasoning' }],
  basicConfig: [
    { key: 'prompt', label: 'Reasoning Task', type: 'template-textarea', placeholder: 'Analyze the data and determine the best course of action.' },
    { key: 'model', label: 'Model', type: 'dropdown', options: [
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet' },
    ]},
    { key: 'temperature', label: 'Temperature', type: 'slider', min: 0, max: 1, step: 0.1 },
    { key: 'maxTokens', label: 'Max Tokens', type: 'number', advancedOnly: true },
  ],
  llmDescription: 'Use when the workflow needs careful deliberation before a decision. Place before Conditional or Router nodes.',
  llmExamples: [{ prompt: 'Analyze the health data and determine if the user should be alerted.', model: 'openai/gpt-4o', temperature: 0.2 }],
};

// LLM Router definition without importing the executor (which pulls in $lib/deepdive/keys — server-only)
const llmRouterDef: NodeDefinition = {
  type: 'llm-router',
  label: 'LLM Router',
  category: 'agentic',
  description: 'LLM-powered semantic routing. Defines named output paths; the LLM picks which to follow.',
  configSchema: {
    type: 'object',
    properties: {
      routes: { type: 'string', description: 'JSON array of { handle, description }' },
      model: { type: 'string', description: 'OpenRouter model ID' },
    },
    required: ['routes'],
  },
  defaultConfig: {
    routes: JSON.stringify([
      { handle: 'route_a', description: 'First option' },
      { handle: 'route_b', description: 'Second option' },
    ], null, 2),
    model: 'openai/gpt-4o-mini',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'route_a', type: 'any', label: 'Route A' },
    { name: 'route_b', type: 'any', label: 'Route B' },
  ],
  basicConfig: [
    { key: 'routes', label: 'Routes (JSON)', type: 'textarea', description: 'Array of { "handle": "name", "description": "when to use" }' },
    { key: 'model', label: 'Model', type: 'dropdown', options: [
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (fast)' },
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku (fast)' },
    ]},
  ],
  llmDescription: 'Use for semantic decisions — choosing paths based on meaning rather than booleans.',
  llmExamples: [{ routes: JSON.stringify([
    { handle: 'positive', description: 'Positive sentiment' },
    { handle: 'negative', description: 'Negative sentiment' },
  ]), model: 'openai/gpt-4o-mini' }],
};

// LLM Agent definition without importing the executor (which pulls in $lib/deepdive/keys — server-only)
const llmAgentDef: NodeDefinition = {
  type: 'llm-agent',
  label: 'LLM Agent',
  category: 'agentic',
  description:
    'Multi-turn LLM agent that can use connected downstream nodes as tools. Loops until the LLM responds without tool calls, or hits iteration/token/timeout limits.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'OpenRouter model ID (default: openai/gpt-4o)' },
      systemPrompt: { type: 'string', description: 'System prompt. Supports {{input.field}} templates.' },
      userPrompt: { type: 'string', description: 'User prompt. Supports {{input.field}} templates.' },
      temperature: { type: 'number', description: 'Sampling temperature 0-2 (default 0.7)' },
      maxTokens: { type: 'number', description: 'Max tokens per LLM call (default 2048)' },
      maxIterations: { type: 'number', description: 'Max tool-use loop iterations (default 10)' },
      maxTotalTokens: { type: 'number', description: 'Total token budget across all iterations (0 = unlimited)' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds (0 = disabled)' },
      toolOverrides: { type: 'string', description: 'JSON object mapping node IDs to { name?, description? } overrides for tool definitions' },
    },
    required: ['userPrompt'],
  },
  defaultConfig: {
    model: 'openai/gpt-4o',
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
    { key: 'model', label: 'Model', type: 'dropdown', options: [
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (fast)' },
      { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet' },
      { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku (fast)' },
    ]},
    { key: 'systemPrompt', label: 'System Prompt', type: 'template-textarea', placeholder: 'You are a helpful assistant...', description: 'Supports {{input.field}} templates' },
    { key: 'userPrompt', label: 'User Prompt', type: 'template-textarea', placeholder: '{{input.query}}', description: 'Supports {{input.field}} templates' },
    { key: 'maxIterations', label: 'Max Iterations', type: 'number', description: 'Maximum tool-use loop iterations', advancedOnly: true },
    { key: 'maxTotalTokens', label: 'Max Total Tokens', type: 'number', description: 'Total token budget (0 = unlimited)', advancedOnly: true },
    { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', description: 'Max execution time in ms (0 = disabled)', advancedOnly: true },
    { key: 'toolOverrides', label: 'Tool Overrides (JSON)', type: 'code', description: 'Override tool names/descriptions: { "nodeId": { "name": "...", "description": "..." } }', advancedOnly: true },
  ],
  llmDescription:
    'Use when the task requires multi-step reasoning with tool use. The agent can call connected nodes as tools in a loop until it has the answer. Best for complex tasks that need planning, research, or iterative refinement.',
  llmExamples: [
    { model: 'openai/gpt-4o', systemPrompt: 'You are a research assistant. Use the available tools to answer questions.', userPrompt: '{{input.question}}', maxIterations: 5 },
  ],
};

// WhatsApp definition without importing the executor (which pulls in baileys — server-only)
const whatsappDef: NodeDefinition = {
  type: 'whatsapp',
  label: 'WhatsApp',
  category: 'integration',
  description: 'Send a WhatsApp message. To and message fields support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient phone number (E.164 format). Supports {{input.field}} templates.' },
      message: { type: 'string', description: 'Message text. Supports {{input.field}} templates.' },
    },
    required: ['to', 'message'],
  },
  defaultConfig: { to: '', message: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'to',
      label: 'To (Phone Number)',
      type: 'text',
      placeholder: '+447359228511 or {{input.phone}}',
      description: 'E.164 format. Supports template interpolation.',
    },
    {
      key: 'message',
      label: 'Message',
      type: 'template-textarea',
      placeholder: 'Hi {{input.name}}, your report is ready.',
      description: 'Message text. Supports {{input.field}} templates.',
    },
  ],
  llmDescription: `Send a WhatsApp message to a phone number. Use this node when a workflow needs to notify someone via WhatsApp.

IMPORTANT: Downstream nodes access this node's result as \`input.sent\`, \`input.messageId\`, or \`input.error\` (the upstream output is merged directly into the downstream input).

The \`to\` field must be an E.164 phone number (e.g., "+447359228511"). Both \`to\` and \`message\` support template interpolation with \`{{input.field}}\` syntax.

Requires an active WhatsApp connection (configured via the WhatsApp settings in the workflows UI).`,
  llmExamples: [
    { to: '+447359228511', message: 'Daily report: {{input.summary}}' },
    { to: '{{input.phone}}', message: '{{input.notification}}' },
  ],
};

const homeAssistantClientDef: NodeDefinition = {
  type: 'home-assistant',
  label: 'Home Assistant',
  category: 'integration',
  description: 'Control Home Assistant: query state, call services, fire events, get history, render templates.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string' },
      entityId: { type: 'string' },
      domain: { type: 'string' },
      service: { type: 'string' },
      serviceData: { type: 'string' },
      eventType: { type: 'string' },
      eventData: { type: 'string' },
      historyStart: { type: 'string' },
      historyEnd: { type: 'string' },
      template: { type: 'string' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'query_state', entityId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'query_state', label: 'Query State' },
      { value: 'call_service', label: 'Call Service' },
      { value: 'fire_event', label: 'Fire Event' },
      { value: 'get_history', label: 'Get History' },
      { value: 'render_template', label: 'Render Template' },
    ]},
    { key: 'entityId', label: 'Entity ID', type: 'template-textarea', placeholder: 'light.living_room_ceiling' },
    { key: 'domain', label: 'Domain', type: 'text', placeholder: 'light', advancedOnly: true },
    { key: 'service', label: 'Service', type: 'text', placeholder: 'turn_on' },
    { key: 'serviceData', label: 'Service Data (JSON)', type: 'textarea', placeholder: '{"brightness": 128}', advancedOnly: true },
    { key: 'eventType', label: 'Event Type', type: 'text', placeholder: 'custom_event', advancedOnly: true },
    { key: 'eventData', label: 'Event Data (JSON)', type: 'textarea', advancedOnly: true },
    { key: 'historyStart', label: 'History Start', type: 'template-textarea', advancedOnly: true },
    { key: 'historyEnd', label: 'History End', type: 'template-textarea', advancedOnly: true },
    { key: 'template', label: 'Template (Jinja2)', type: 'code', placeholder: '{{ states("light.living_room") }}', advancedOnly: true },
  ],
  llmDescription: 'Control Home Assistant smart home devices. Query state, call services, fire events, get history, or render templates.',
  llmExamples: [
    { operation: 'query_state', entityId: 'sensor.living_room_temperature' },
    { operation: 'call_service', entityId: 'light.kitchen', domain: 'light', service: 'turn_off' },
  ],
};

const healthQueryClientDef: NodeDefinition = {
  type: 'health-query',
  label: 'Health Query',
  category: 'integration',
  description: 'Query health data from Strava, Apple Watch, and other fitness sources.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'stats | readiness | sleep | training_load | timeline' },
      page: { type: 'string', description: 'Page number for timeline (default 1). Supports templates.' },
      limit: { type: 'string', description: 'Items per page for timeline (default 20). Supports templates.' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'stats' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Operation', type: 'dropdown',
      options: [
        { value: 'stats', label: 'Stats' },
        { value: 'readiness', label: 'Readiness' },
        { value: 'sleep', label: 'Sleep' },
        { value: 'training_load', label: 'Training Load' },
        { value: 'timeline', label: 'Timeline' },
      ],
    },
    { key: 'page', label: 'Page', type: 'text', placeholder: '1' },
    { key: 'limit', label: 'Limit', type: 'text', placeholder: '20' },
  ],
  llmDescription: `Query health data from Strava and Apple Watch including fitness stats, readiness scores, sleep analysis, training load, and activity timeline.

1. **stats** — Get current fitness stats summary (HR, steps, active calories, etc.)
2. **readiness** — Get readiness/recovery score based on HRV, sleep, and training load
3. **sleep** — Get sleep analysis data (duration, stages, quality)
4. **training_load** — Get training load and fitness/fatigue metrics
5. **timeline** — Get paginated activity timeline. Supports page/limit params.

IMPORTANT: Downstream nodes access this node's result as \`input.success\`, \`input.data\`, \`input.error\` (the upstream output is merged directly into the downstream input).`,
  llmExamples: [
    { operation: 'readiness' },
    { operation: 'stats' },
    { operation: 'timeline', page: '1', limit: '10' },
  ],
};

const blogClientDef: NodeDefinition = {
  type: 'blog',
  label: 'Blog',
  category: 'integration',
  description: 'Manage blog posts: list, get, create, and update.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'list | get | create | update' },
      postId: { type: 'string', description: 'Post ID for get/update. Supports templates.' },
      title: { type: 'string', description: 'Post title. Supports templates.' },
      content: { type: 'string', description: 'Post content (HTML). Supports templates.' },
      status: { type: 'string', description: 'Post status (draft | published)' },
      tags: { type: 'string', description: 'Comma-separated tags' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Operation', type: 'dropdown',
      options: [
        { value: 'list', label: 'List Posts' },
        { value: 'get', label: 'Get Post' },
        { value: 'create', label: 'Create Post' },
        { value: 'update', label: 'Update Post' },
      ],
    },
    { key: 'postId', label: 'Post ID', type: 'template-textarea', placeholder: '{{input.id}}' },
    { key: 'title', label: 'Title', type: 'template-textarea', placeholder: 'My Blog Post' },
    { key: 'content', label: 'Content', type: 'template-textarea', placeholder: '<p>Post content here...</p>' },
    { key: 'status', label: 'Status', type: 'dropdown', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] },
    { key: 'tags', label: 'Tags', type: 'text', placeholder: 'tech, ai, personal' },
  ],
  llmDescription: `Manage blog posts on the site. Supports four operations:

1. **list** — List all blog posts (most recent first, up to 50)
2. **get** — Get a single post by ID
3. **create** — Create a new blog post. Requires title; content, status, and tags are optional.
4. **update** — Update an existing post by ID. Pass only the fields to change.

IMPORTANT: Downstream nodes access this node's result as \`input.success\`, \`input.data\`, \`input.error\` (the upstream output is merged directly into the downstream input).

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'list' },
    { operation: 'create', title: 'Weekly Update', content: '<p>This week...</p>', status: 'draft', tags: 'weekly, update' },
    { operation: 'update', postId: '{{input.id}}', status: 'published' },
  ],
};

const jkaiClientDef: NodeDefinition = {
  type: 'jkai',
  label: 'JKAI',
  category: 'integration',
  description: 'Manage JKAI autonomous builds: start, check status, list, and control.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'start | status | list | control' },
      prompt: { type: 'string', description: 'Build prompt for start. Supports templates.' },
      title: { type: 'string', description: 'Optional build title. Supports templates.' },
      buildId: { type: 'string', description: 'Build ID for status/control. Supports templates.' },
      action: { type: 'string', description: 'Control action (pause | resume | cancel)' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Operation', type: 'dropdown',
      options: [
        { value: 'start', label: 'Start Build' },
        { value: 'status', label: 'Check Status' },
        { value: 'list', label: 'List Builds' },
        { value: 'control', label: 'Control Build' },
      ],
    },
    { key: 'prompt', label: 'Prompt', type: 'template-textarea', placeholder: 'Build a landing page with...' },
    { key: 'title', label: 'Title', type: 'text', placeholder: 'My Build' },
    { key: 'buildId', label: 'Build ID', type: 'template-textarea', placeholder: '{{input.buildId}}' },
    {
      key: 'action', label: 'Action', type: 'dropdown',
      options: [
        { value: 'pause', label: 'Pause' },
        { value: 'resume', label: 'Resume' },
        { value: 'cancel', label: 'Cancel' },
      ],
    },
  ],
  llmDescription: `Manage JKAI autonomous code builds in a Docker sandbox. Supports four operations:

1. **start** — Start a new build with a prompt (and optional title)
2. **status** — Check the status of a build by ID
3. **list** — List all builds (most recent first, up to 50)
4. **control** — Control a running build (pause, resume, cancel)

IMPORTANT: Downstream nodes access this node's result as \`input.success\`, \`input.data\`, \`input.error\` (the upstream output is merged directly into the downstream input).

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'list' },
    { operation: 'start', prompt: 'Build a React dashboard with charts', title: 'Dashboard Build' },
    { operation: 'status', buildId: '{{input.data.id}}' },
    { operation: 'control', buildId: '{{input.data.id}}', action: 'cancel' },
  ],
};

const deepDiveClientDef: NodeDefinition = {
  type: 'deep-dive',
  label: 'Deep Dive',
  category: 'integration',
  description: 'Run deep research sessions: start, check status, list, get reports, and control.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'start | status | list | report | control' },
      topic: { type: 'string', description: 'Research topic. Supports templates.' },
      goals: { type: 'string', description: 'Research goals/objectives. Supports templates.' },
      depth: { type: 'string', description: 'Research depth (shallow | medium | deep)' },
      sessionId: { type: 'string', description: 'Session ID for status/report/control. Supports templates.' },
      action: { type: 'string', description: 'Control action (pause | resume | cancel)' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Operation', type: 'dropdown',
      options: [
        { value: 'start', label: 'Start Research' },
        { value: 'status', label: 'Check Status' },
        { value: 'list', label: 'List Sessions' },
        { value: 'report', label: 'Get Report' },
        { value: 'control', label: 'Control Session' },
      ],
    },
    { key: 'topic', label: 'Topic', type: 'template-textarea', placeholder: 'Impact of AI on software engineering' },
    { key: 'goals', label: 'Goals', type: 'textarea', placeholder: 'Understand trends, key players, future outlook' },
    {
      key: 'depth', label: 'Depth', type: 'dropdown',
      options: [
        { value: 'shallow', label: 'Shallow' },
        { value: 'medium', label: 'Medium' },
        { value: 'deep', label: 'Deep' },
      ],
    },
    { key: 'sessionId', label: 'Session ID', type: 'template-textarea', placeholder: '{{input.data.id}}' },
    {
      key: 'action', label: 'Action', type: 'dropdown',
      options: [
        { value: 'pause', label: 'Pause' },
        { value: 'resume', label: 'Resume' },
        { value: 'cancel', label: 'Cancel' },
      ],
    },
  ],
  llmDescription: `Run deep research sessions on any topic using web search, analysis, and synthesis. Supports five operations:

1. **start** — Start a new research session with a topic, optional goals, and depth level
2. **status** — Check the progress of a research session by ID
3. **list** — List all research sessions (most recent first, up to 50)
4. **report** — Get the full research report for a completed session
5. **control** — Control a running session (pause, resume, cancel)

IMPORTANT: Downstream nodes access this node's result as \`input.success\`, \`input.data\`, \`input.error\` (the upstream output is merged directly into the downstream input).

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'list' },
    { operation: 'start', topic: 'Quantum computing breakthroughs 2026', goals: 'Key advances, practical applications', depth: 'deep' },
    { operation: 'status', sessionId: '{{input.data.id}}' },
    { operation: 'report', sessionId: '{{input.data.id}}' },
  ],
};

const builtInDefinitions: NodeDefinition[] = [
  manualTriggerDef,
  transformDef,
  codeExecuteDef,
  delayDef,
  httpRequestDef,
  llmCallDef,
  emailDef,
  dataStoreDef,
  loopDef,
  conditionalDef,
  whoopDef,
  stravaDef,
  openrouterDef,
  errorHandlerDef,
  textParserDef,
  validatorDef,
  thinkDef,
  llmRouterDef,
  mergeDef,
  accumulatorDef,
  subWorkflowDef,
  llmAgentDef,
  whatsappDef,
  homeAssistantClientDef,
  healthQueryClientDef,
  blogClientDef,
  jkaiClientDef,
  deepDiveClientDef,
];

export const nodeDefinitions: NodeDefinition[] = builtInDefinitions;

export function getDefinition(type: string): NodeDefinition | undefined {
  return nodeDefinitions.find((d) => d.type === type);
}

export type {
  WorkflowDefinition,
  WorkflowNodeDef,
  WorkflowEdgeDef,
  NodeDefinition,
  Position,
  PortDefinition,
  JsonSchema,
} from './types';
