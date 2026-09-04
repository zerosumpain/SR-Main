import type { NodeDefinition } from '../types';

export const fileBuildDef: NodeDefinition = {
  type: 'file-build',
  label: 'Build new file',
  category: 'integration',
  description: 'Synthesise a new file (docx / pdf / html / xlsx / csv) from text / markdown / json / csv / xlsx input.',
  configSchema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['docx', 'pdf', 'html', 'xlsx', 'csv'], description: 'Output format.' },
      source: { type: 'string', enum: ['markdown', 'text', 'json', 'csv', 'xlsx'], description: 'Format of the supplied content.' },
      contentPath: { type: 'string', description: 'Dot-path into input pointing at the content. Defaults to `input.content`.' },
      title: { type: 'string', description: 'Optional title for docx/pdf output.' },
      persist: { type: 'boolean', description: 'Save the output to the file store.' },
      outputName: { type: 'string', description: 'Required when persist=true.' },
    },
    required: ['format', 'source'],
  },
  defaultConfig: { persist: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'File' }],
  basicConfig: [
    {
      key: 'format', label: 'Output format', type: 'dropdown', description: 'What kind of file to produce.',
      options: [
        { value: 'docx', label: 'DOCX (Word)' },
        { value: 'pdf', label: 'PDF' },
        { value: 'html', label: 'HTML' },
        { value: 'xlsx', label: 'XLSX (Excel)' },
        { value: 'csv', label: 'CSV' },
      ],
    },
    {
      key: 'source', label: 'Input format', type: 'dropdown', description: 'Format of the content you are providing.',
      options: [
        { value: 'markdown', label: 'Markdown' },
        { value: 'text', label: 'Plain text' },
        { value: 'json', label: 'JSON (array of rows)' },
        { value: 'csv', label: 'CSV' },
        { value: 'xlsx', label: 'XLSX (binary, base64)' },
      ],
    },
    { key: 'contentPath', label: 'Content path', type: 'text', placeholder: 'data.body', description: 'Dot-path into input. Default `input.content`.' },
    { key: 'title', label: 'Title', type: 'text', description: 'Optional title for docx/pdf.' },
    { key: 'persist', label: 'Save to file store', type: 'toggle', description: 'When on, the output becomes a new workflow file.' },
    { key: 'outputName', label: 'Saved file name', type: 'template-textarea', placeholder: 'reports/{{input.id}}.docx', description: 'Required when "Save to file store" is on.', visibleWhen: { key: 'persist', equals: true } },
  ],
  llmDescription: 'Use this to render text/markdown/json/csv into a downloadable file. Output is always { base64, mimeType, sizeBytes, suggestedExtension }, plus { file } when persist=true. To pull text out of an existing file use `file-text-extract` instead.',
  llmExamples: [
    { format: 'docx', source: 'markdown', contentPath: 'input.report', persist: true, outputName: 'reports/{{input.id}}.docx' },
    { format: 'xlsx', source: 'json', contentPath: 'input.rows' },
    { format: 'pdf', source: 'markdown', contentPath: 'input.body', title: 'Weekly summary' },
  ],
};
