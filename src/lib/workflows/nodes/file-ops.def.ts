import type { NodeDefinition } from '../types';

export const fileReadDef: NodeDefinition = {
  type: 'file-read',
  label: 'Read file',
  category: 'integration',
  description: 'Load a file from the workflow file store. Returns content as utf8 (default) or base64.',
  configSchema: {
    type: 'object',
    properties: {
      fileName: { type: 'string', description: 'Name of the file in the store. Supports {{input.field}}.' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'utf8 for text, base64 for binary.' },
    },
    required: ['fileName'],
  },
  defaultConfig: { encoding: 'utf8' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'File content' }],
  basicConfig: [
    { key: 'fileName', label: 'File name', type: 'template-textarea', placeholder: 'reports/daily.csv', description: 'Supports {{input.field}}.' },
    {
      key: 'encoding', label: 'Encoding', type: 'dropdown', description: 'utf8 for text, base64 for binary.',
      options: [
        { value: 'utf8', label: 'utf8 (text)' },
        { value: 'base64', label: 'base64 (binary)' },
      ],
    },
  ],
  llmDescription: 'Read content of an existing file in the workflow store. Output: { name, mimeType, sizeBytes, encoding, content }.',
  llmExamples: [
    { fileName: 'config.json' },
    { fileName: '{{input.attachment.name}}', encoding: 'base64' },
  ],
};

export const fileWriteDef: NodeDefinition = {
  type: 'file-write',
  label: 'Write file',
  category: 'integration',
  description: 'Create or overwrite a file in the workflow store. Set `append: true` to append to an existing file instead.',
  configSchema: {
    type: 'object',
    properties: {
      fileName: { type: 'string', description: 'Name of the file. Supports {{input.field}}.' },
      append: { type: 'boolean', description: 'When true, append to an existing file instead of overwriting. File must already exist.' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'utf8 for text, base64 for binary.' },
      contentPath: { type: 'string', description: 'Dot-path into input. Defaults to `input.content`, then the whole input.' },
    },
    required: ['fileName'],
  },
  defaultConfig: { append: false, encoding: 'utf8' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'fileName', label: 'File name', type: 'template-textarea', placeholder: 'logs/{{input.id}}.txt', description: 'Supports {{input.field}}.' },
    { key: 'append', label: 'Append mode', type: 'toggle', description: 'When on, append to an existing file (does not create).' },
    {
      key: 'encoding', label: 'Encoding', type: 'dropdown', description: 'utf8 for text, base64 for binary.',
      options: [
        { value: 'utf8', label: 'utf8 (text)' },
        { value: 'base64', label: 'base64 (binary)' },
      ],
    },
    { key: 'contentPath', label: 'Content path', type: 'text', placeholder: 'data.body', description: 'Dot-path into input.' },
  ],
  llmDescription: 'Persist content to the workflow file store. Default behaviour overwrites or creates. Set `append: true` to append (file must already exist). To delete, use `file-delete`.',
  llmExamples: [
    { fileName: 'out.txt', contentPath: 'result.text' },
    { fileName: 'logs/{{input.id}}.json', contentPath: 'payload' },
    { fileName: 'log.txt', append: true, contentPath: 'line' },
  ],
};

export const fileDeleteDef: NodeDefinition = {
  type: 'file-delete',
  label: 'Delete file',
  category: 'integration',
  description: 'Remove a file from the workflow file store. Idempotent — silently succeeds if the file is already gone.',
  configSchema: {
    type: 'object',
    properties: {
      fileName: { type: 'string', description: 'Name of the file. Supports {{input.field}}.' },
    },
    required: ['fileName'],
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'fileName', label: 'File name', type: 'template-textarea', description: 'Supports {{input.field}}.' },
  ],
  llmDescription: 'Delete a workflow file by name. Output: { ok, deleted, name }.',
  llmExamples: [{ fileName: 'tmp/{{input.id}}.csv' }],
};

export const fileListDef: NodeDefinition = {
  type: 'file-list',
  label: 'List files',
  category: 'integration',
  description: 'List every file in the workflow store, optionally filtered by name prefix.',
  configSchema: {
    type: 'object',
    properties: {
      prefix: { type: 'string', description: 'Only return files whose name starts with this prefix. Empty = list all.' },
    },
  },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Listing' }],
  basicConfig: [
    { key: 'prefix', label: 'Name prefix', type: 'text', placeholder: 'logs/', description: 'Optional. Empty lists all files.' },
  ],
  llmDescription: 'Get a directory-style listing of files in the store. Output: { files: [...], count }.',
  llmExamples: [{}, { prefix: 'logs/' }],
};
