import type { NodeDefinition } from '../types';

export const dataStoreDef: NodeDefinition = {
  type: 'data-store',
  label: 'Data Store',
  category: 'core',
  description: 'Read or write a value in the workflow-scoped key-value store. Persists across runs.',
  configSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['get', 'set'],
        description: "'get' reads a stored value; 'set' writes one. NOT 'read' / 'write' — those are rejected at save time.",
      },
      key: { type: 'string', description: 'Key name. Supports {{input.field}} templates.' },
      valuePath: {
        type: 'string',
        description: "Dot-path into input to extract the value to store (set only). Defaults to input.value or whole input.",
      },
    },
    required: ['operation', 'key'],
  },
  defaultConfig: { operation: 'get', key: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation',
      label: 'Action',
      type: 'dropdown',
      description: 'Whether to read a saved value or write one.',
      options: [
        { value: 'get', label: 'Get (read value)' },
        { value: 'set', label: 'Set (write value)' },
      ],
    },
    {
      key: 'key',
      label: 'Key',
      type: 'template-textarea',
      description: 'Name of the stored item. Supports {{input.field}} templates so keys can be dynamic.',
      placeholder: 'last_run_timestamp',
    },
    {
      key: 'valuePath',
      label: 'Value Path',
      type: 'text',
      description: 'Dot-path into the input to pick the value to store (e.g. data.count). Leave empty to store input.value or the whole input.',
      placeholder: 'data.count',
      visibleWhen: { key: 'operation', equals: 'set' },
    },
  ],
  llmDescription:
    "Workflow-scoped persistent key-value store. Survives across runs of the same workflow — use it to remember 'last processed message id', cursors for incremental sync, accumulated counters, or cached external lookups. Get/set only (no delete from this node). Keys are listed in the prompt's Workspace Resources for the current workflow; reference them verbatim. NOT for sharing data between workflows (use sub-workflow input/output) and NOT a general database (small JSON values only).",
  llmExamples: [
    { operation: 'get', key: 'last_processed_message_id' },
    { operation: 'set', key: 'last_processed_message_id', valuePath: 'messageId' },
    { operation: 'set', key: 'cursor_{{trigger.output.accountId}}', valuePath: 'data.historyId' },
  ],
};
