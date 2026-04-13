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
    },
    required: ['code'],
  },
  defaultConfig: { language: 'javascript', code: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
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
