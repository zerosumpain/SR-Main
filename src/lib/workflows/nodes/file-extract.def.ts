// src/lib/workflows/nodes/file-extract.def.ts
import type { NodeDefinition } from '../types';

export const fileExtractDef: NodeDefinition = {
  type: 'file-extract',
  label: 'File Extract / Convert (legacy)',
  category: 'integration',
  hidden: true,
  description:
    'Legacy multi-mode node. Replaced by `file-text-extract` (extract) and `file-build` (synthesise). Existing canvases keep running; new canvases should use the split versions.',
  configSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['extract', 'synthesize'] },
      // extract
      fileName: { type: 'string', description: 'Source file in the workflow file store. Supports {{input.x}} templates.' },
      pageFrom: { type: 'number', description: 'PDF only: 1-indexed first page' },
      pageTo: { type: 'number', description: 'PDF only: 1-indexed last page (inclusive)' },
      language: { type: 'string', description: 'Audio/video: language hint for Whisper (BCP-47, e.g. en, es)' },
      // synthesize
      format: { type: 'string', enum: ['docx', 'pdf', 'html', 'xlsx', 'csv'] },
      source: { type: 'string', enum: ['markdown', 'text', 'json', 'csv', 'xlsx'] },
      contentPath: { type: 'string', description: 'Dot-path into input for synthesise content. Defaults to input.content.' },
      title: { type: 'string' },
      // shared
      persist: { type: 'boolean', description: 'Save the result as a new workflow file.' },
      outputName: { type: 'string', description: 'Required when persist=true. Name of the new file in the store.' },
    },
    required: ['mode'],
  },
  defaultConfig: { mode: 'extract', persist: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'dropdown',
      description: 'Extract pulls text out of a stored file. Synthesise builds a new file from input data.',
      options: [
        { value: 'extract', label: 'Extract text from file' },
        { value: 'synthesize', label: 'Synthesise new file' },
      ],
    },
    {
      key: 'fileName',
      label: 'Source file',
      type: 'template-textarea',
      description: 'Name of the file in the store. Supports {{input.field}} templates.',
      placeholder: 'docs/contract.pdf',
      visibleWhen: { key: 'mode', equals: 'extract' },
    },
    {
      key: 'pageFrom',
      label: 'First page (PDF only)',
      type: 'text',
      description: '1-indexed. Leave empty for all pages.',
      visibleWhen: { key: 'mode', equals: 'extract' },
    },
    {
      key: 'pageTo',
      label: 'Last page (PDF only)',
      type: 'text',
      description: 'Inclusive. Leave empty for last page.',
      visibleWhen: { key: 'mode', equals: 'extract' },
    },
    {
      key: 'language',
      label: 'Language (audio/video)',
      type: 'text',
      description: 'BCP-47 hint, e.g. en. Leave empty for auto-detect.',
      placeholder: 'en',
      visibleWhen: { key: 'mode', equals: 'extract' },
    },
    {
      key: 'format',
      label: 'Output format',
      type: 'dropdown',
      description: 'What kind of file to produce.',
      options: [
        { value: 'docx', label: 'DOCX (Word)' },
        { value: 'pdf', label: 'PDF' },
        { value: 'html', label: 'HTML' },
        { value: 'xlsx', label: 'XLSX (Excel)' },
        { value: 'csv', label: 'CSV' },
      ],
      visibleWhen: { key: 'mode', equals: 'synthesize' },
    },
    {
      key: 'source',
      label: 'Input format',
      type: 'dropdown',
      description: 'Format of the content you are providing.',
      options: [
        { value: 'markdown', label: 'Markdown' },
        { value: 'text', label: 'Plain text' },
        { value: 'json', label: 'JSON (array of rows)' },
        { value: 'csv', label: 'CSV' },
        { value: 'xlsx', label: 'XLSX (binary, base64)' },
      ],
      visibleWhen: { key: 'mode', equals: 'synthesize' },
    },
    {
      key: 'contentPath',
      label: 'Content path',
      type: 'text',
      description: 'Dot-path into input (default: input.content).',
      placeholder: 'data.body',
      visibleWhen: { key: 'mode', equals: 'synthesize' },
    },
    {
      key: 'title',
      label: 'Title',
      type: 'text',
      description: 'Optional title for docx/pdf output.',
      visibleWhen: { key: 'mode', equals: 'synthesize' },
    },
    {
      key: 'persist',
      label: 'Save to file store',
      type: 'dropdown',
      description: 'When on, the result becomes a new workflow file (browseable in /drive).',
      options: [
        { value: 'false', label: 'No (in-memory only)' },
        { value: 'true', label: 'Yes' },
      ],
    },
    {
      key: 'outputName',
      label: 'Saved file name',
      type: 'template-textarea',
      description: 'Required when "Save to file store" is on.',
      placeholder: 'reports/output.docx',
    },
  ],
  llmDescription:
    'Use file-extract to (a) pull plain text + structured metadata out of an existing PDF/DOCX/MD/audio/video file in the workflow file store, or (b) synthesise a new file (docx/pdf/html/xlsx/csv) from text/markdown/json/csv. In extract mode, output is { text, meta, sourceFile }. In synthesise mode, output is { base64, mimeType, sizeBytes, suggestedExtension } and a { file } sub-object when persist=true.',
  llmExamples: [
    { mode: 'extract', fileName: 'contract.pdf' },
    { mode: 'extract', fileName: 'meeting.mp4', language: 'en' },
    { mode: 'synthesize', format: 'docx', source: 'markdown', contentPath: 'input.report', persist: true, outputName: 'reports/{{input.id}}.docx' },
    { mode: 'synthesize', format: 'xlsx', source: 'json', contentPath: 'input.rows' },
  ],
};
