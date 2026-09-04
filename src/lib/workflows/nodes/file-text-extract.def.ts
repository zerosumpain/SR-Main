import type { NodeDefinition } from '../types';

export const fileTextExtractDef: NodeDefinition = {
  type: 'file-text-extract',
  label: 'Extract text from file',
  category: 'integration',
  description: 'Pull plain text + structured metadata out of a PDF / DOCX / Markdown / audio / video file in the workflow file store.',
  configSchema: {
    type: 'object',
    properties: {
      fileName: { type: 'string', description: 'Name of the source file in the store. Supports {{input.field}} templates.' },
      pageFrom: { type: 'number', description: 'PDF only: 1-indexed first page (omit for all pages).' },
      pageTo: { type: 'number', description: 'PDF only: 1-indexed last page (inclusive).' },
      language: { type: 'string', description: 'Audio/video: BCP-47 language hint for Whisper, e.g. "en". Omit for auto-detect.' },
      persist: { type: 'boolean', description: 'Save the extracted text as a new .txt file in the store.' },
      outputName: { type: 'string', description: 'Required when persist=true. Name for the saved .txt file.' },
    },
    required: ['fileName'],
  },
  defaultConfig: { persist: false },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Extracted' }],
  basicConfig: [
    { key: 'fileName', label: 'Source file', type: 'template-textarea', placeholder: 'docs/contract.pdf', description: 'Name of the file in the store.' },
    { key: 'pageFrom', label: 'First page (PDF)', type: 'text', placeholder: '1', description: 'Optional. 1-indexed.' },
    { key: 'pageTo', label: 'Last page (PDF)', type: 'text', placeholder: '5', description: 'Optional. Inclusive.' },
    { key: 'language', label: 'Language (audio/video)', type: 'text', placeholder: 'en', description: 'BCP-47 hint.' },
    { key: 'persist', label: 'Save as new .txt', type: 'toggle', description: 'Persist the extracted text to the file store.' },
    { key: 'outputName', label: 'Saved file name', type: 'template-textarea', placeholder: 'reports/{{input.id}}.txt', description: 'Required when "Save as new .txt" is on.', visibleWhen: { key: 'persist', equals: true } },
  ],
  llmDescription: 'Use this when you need the text contents of a file already in the workflow file store. Output is { text, meta, sourceFile }, plus { file } when persist=true. To create a new file from text/markdown/json/csv use `file-build` instead.',
  llmExamples: [
    { fileName: 'contract.pdf' },
    { fileName: 'meeting.mp4', language: 'en' },
    { fileName: '{{input.upload.name}}', persist: true, outputName: 'extracted/{{input.upload.name}}.txt' },
  ],
};
