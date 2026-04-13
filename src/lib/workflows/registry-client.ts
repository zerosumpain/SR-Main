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
import type { NodeDefinition } from './types';

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

export const nodeDefinitions: NodeDefinition[] = [
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
];

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
