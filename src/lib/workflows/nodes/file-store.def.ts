import type { NodeDefinition } from '../types';

export const fileStoreDef: NodeDefinition = {
  type: 'file-store',
  label: 'File Store (legacy)',
  category: 'integration',
  hidden: true,
  description:
    'Legacy multi-mode node. Replaced by `file-read`, `file-write` (with append toggle), `file-delete`, and `file-list`. Existing canvases keep running; new canvases should use the per-operation versions.',
  configSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['read', 'write', 'append', 'delete', 'list'],
        description: 'Which file operation to perform.',
      },
      fileName: {
        type: 'string',
        description: 'Name of the file in the store. Supports {{input.field}} templates. Not required for list.',
      },
      encoding: {
        type: 'string',
        enum: ['utf8', 'base64'],
        description: 'How to encode file content on read / decode on write. Default utf8 for text, base64 for binary.',
      },
      contentPath: {
        type: 'string',
        description: 'Dot-path into input to extract content for write/append (defaults to input.content, then the whole input).',
      },
      prefix: {
        type: 'string',
        description: 'Optional name prefix filter for list operation.',
      },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'read', fileName: '', encoding: 'utf8' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation',
      label: 'Operation',
      type: 'dropdown',
      description: 'Which file operation to perform. Each operation requires matching permission on the target file.',
      options: [
        { value: 'read', label: 'Read (load content)' },
        { value: 'write', label: 'Write (overwrite)' },
        { value: 'append', label: 'Append' },
        { value: 'delete', label: 'Delete' },
        { value: 'list', label: 'List (all files)' },
      ],
    },
    {
      key: 'fileName',
      label: 'File name',
      type: 'template-textarea',
      description: 'Name of the file in the store. Supports {{input.field}} templates.',
      placeholder: 'reports/daily.csv',
      visibleWhen: { key: 'operation', in: ['read', 'write', 'append', 'delete'] },
    },
    {
      key: 'encoding',
      label: 'Encoding',
      type: 'dropdown',
      description: 'utf8 for text files, base64 for binary content.',
      options: [
        { value: 'utf8', label: 'utf8 (text)' },
        { value: 'base64', label: 'base64 (binary)' },
      ],
      visibleWhen: { key: 'operation', in: ['read', 'write', 'append'] },
    },
    {
      key: 'contentPath',
      label: 'Content path',
      type: 'text',
      description: 'Dot-path into input to extract content (e.g. data.body). Defaults to input.content, then the whole input as string.',
      placeholder: 'data.body',
      visibleWhen: { key: 'operation', in: ['write', 'append'] },
    },
    {
      key: 'prefix',
      label: 'Name prefix filter',
      type: 'text',
      description: 'Only list files whose name starts with this prefix. Leave empty to list all.',
      placeholder: 'reports/',
      visibleWhen: { key: 'operation', equals: 'list' },
    },
  ],
  llmDescription:
    'Use the file-store node to persist or retrieve files that live outside a single run. Files are uploaded/managed via the /drive admin page. Reads return { content, name, mimeType, sizeBytes }. Writes/appends take content from input.content (or the whole input). Each file has per-operation permissions; the node throws if the operation is not permitted on the target file.',
  llmExamples: [
    { operation: 'read', fileName: 'config.json', encoding: 'utf8' },
    { operation: 'write', fileName: 'out.txt', encoding: 'utf8', contentPath: 'result.text' },
    { operation: 'list', prefix: 'logs/' },
  ],
};
