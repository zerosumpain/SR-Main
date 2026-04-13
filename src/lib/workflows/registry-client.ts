/**
 * Client-safe registry module with definitions only (no executors).
 * Does NOT import engine, events, or sandbox (Node.js-only modules).
 * Use this from page components. Use '$lib/workflows' from +server.ts routes.
 */
import { manualTriggerDef } from './nodes/manual-trigger';
import { transformDef } from './nodes/transform';
import { delayDef } from './nodes/delay';
import { httpRequestDef } from './nodes/http-request';
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

export const nodeDefinitions: NodeDefinition[] = [
  manualTriggerDef,
  transformDef,
  codeExecuteDef,
  delayDef,
  httpRequestDef,
  llmCallDef,
  emailDef,
  dataStoreDef,
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
