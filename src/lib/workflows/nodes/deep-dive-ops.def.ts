import type { NodeDefinition } from '../types';

export const deepDiveStartDef: NodeDefinition = {
  type: 'deep-dive-start',
  label: 'Deep dive: start',
  category: 'integration',
  description: 'Kick off a new deep research session. Returns a session id you can poll with `deep-dive-status` or fetch the report with `deep-dive-report`.',
  configSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'What to research. Supports {{input.field}}.' },
      goals: { type: 'string', description: 'Optional objectives / questions to address.' },
      depth: { type: 'string', enum: ['shallow', 'medium', 'deep'], description: 'How thorough.' },
    },
    required: ['topic'],
  },
  defaultConfig: { depth: 'medium' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Session' }],
  basicConfig: [
    { key: 'topic', label: 'Topic', type: 'template-textarea', placeholder: 'Impact of AI on software engineering', description: 'Supports {{input.field}}.' },
    { key: 'goals', label: 'Goals', type: 'template-textarea', placeholder: 'Understand trends, key players, future outlook', description: 'Optional.' },
    {
      key: 'depth', label: 'Depth', type: 'dropdown', description: 'How thorough.',
      options: [
        { value: 'shallow', label: 'Shallow (quick skim)' },
        { value: 'medium', label: 'Medium (balanced)' },
        { value: 'deep', label: 'Deep (thorough)' },
      ],
    },
  ],
  llmDescription: 'Start a research session. Output: { success, data: { id, ... } } — pass `data.id` to deep-dive-status / deep-dive-report. Research runs asynchronously; status polling continues until done.',
  llmExamples: [
    { topic: 'Quantum computing breakthroughs 2026', goals: 'Key advances, practical applications', depth: 'deep' },
    { topic: '{{input.subject}}' },
  ],
};

export const deepDiveStatusDef: NodeDefinition = {
  type: 'deep-dive-status',
  label: 'Deep dive: check status',
  category: 'integration',
  description: 'Check progress of a running research session.',
  configSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID. Supports {{input.field}}, e.g. {{input.data.id}}.' },
    },
    required: ['sessionId'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Status' }],
  basicConfig: [
    { key: 'sessionId', label: 'Session ID', type: 'template-textarea', placeholder: '{{input.data.id}}', description: 'Supports {{input.field}}.' },
  ],
  llmDescription: 'Get the status of a research session. Output: { success, data: { status, progress, ... } }.',
  llmExamples: [{ sessionId: '{{input.data.id}}' }],
};

export const deepDiveReportDef: NodeDefinition = {
  type: 'deep-dive-report',
  label: 'Deep dive: get report',
  category: 'integration',
  description: 'Fetch the final report for a completed research session.',
  configSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID. Supports {{input.field}}.' },
    },
    required: ['sessionId'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Report' }],
  basicConfig: [
    { key: 'sessionId', label: 'Session ID', type: 'template-textarea', placeholder: '{{input.data.id}}', description: 'Supports {{input.field}}.' },
  ],
  llmDescription: 'Pull the rendered research report. Output: { success, data: { report, citations, ... } }.',
  llmExamples: [{ sessionId: '{{input.data.id}}' }],
};

export const deepDiveListDef: NodeDefinition = {
  type: 'deep-dive-list',
  label: 'Deep dive: list sessions',
  category: 'integration',
  description: 'List recent research sessions (most recent first).',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Sessions' }],
  basicConfig: [],
  llmDescription: 'List research sessions. No config. Output: { success, data: { sessions: [...] } }.',
  llmExamples: [{}],
};

export const deepDiveControlDef: NodeDefinition = {
  type: 'deep-dive-control',
  label: 'Deep dive: control session',
  category: 'integration',
  description: 'Pause, resume, or cancel a running research session.',
  configSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID. Supports {{input.field}}.' },
      action: { type: 'string', enum: ['pause', 'resume', 'cancel'], description: 'What to do.' },
    },
    required: ['sessionId', 'action'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'sessionId', label: 'Session ID', type: 'template-textarea', placeholder: '{{input.data.id}}', description: 'Supports {{input.field}}.' },
    {
      key: 'action', label: 'Action', type: 'dropdown', description: 'What to do.',
      options: [
        { value: 'pause', label: 'Pause' },
        { value: 'resume', label: 'Resume' },
        { value: 'cancel', label: 'Cancel' },
      ],
    },
  ],
  llmDescription: 'Pause / resume / cancel a research session.',
  llmExamples: [
    { sessionId: '{{input.data.id}}', action: 'cancel' },
  ],
};
