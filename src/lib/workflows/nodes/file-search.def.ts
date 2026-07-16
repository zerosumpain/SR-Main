import type { NodeDefinition } from '../types';

/**
 * Dedicated RAG node over the /drive file index (pgvector). Thin wrapper over the
 * SAME `searchFiles` lib the `file_search` site tool uses — a direct lib import
 * (not the tool registry) so the node returns a clean { results, count } shape
 * without the tool envelope. Read-only; safe to run under dryRun.
 */
export const fileSearchDef: NodeDefinition = {
  type: 'file-search',
  label: 'File search (RAG)',
  category: 'integration',
  description:
    'Semantic search across the CONTENT of every file in the /drive store — text by meaning, images by visual content + OCR, audio by transcript. Returns ranked passages with the source file name and id.',
  configSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural-language description of what to find. Supports {{input.field}} / {{state.KEY}} templates.',
      },
      topK: { type: 'number', description: 'Max passages to return, 1–30 (default 5).' },
      fileTypes: {
        type: 'string',
        description:
          'Optional comma-separated modality filter — keep only these kinds of matches: text, image, audio. Blank = all modalities.',
      },
    },
    required: ['query'],
  },
  defaultConfig: { query: '{{input.query}}', topK: 5, fileTypes: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Search results' }],
  basicConfig: [
    {
      key: 'query',
      label: 'Search query',
      type: 'template-textarea',
      placeholder: 'the invoice that mentions refunds',
      description: 'What to find, by what the file contains or depicts. Supports {{input.field}} templates.',
    },
    {
      key: 'topK',
      label: 'Max results',
      type: 'slider',
      min: 1,
      max: 30,
      step: 1,
      description: 'Number of ranked passages to return (1–30).',
    },
    {
      key: 'fileTypes',
      label: 'Modality filter',
      type: 'text',
      placeholder: 'text, image, audio',
      description: 'Comma-separated modalities to keep (text / image / audio). Blank keeps all.',
    },
  ],
  summarize: (config) => {
    const query = String(config.query ?? '').trim();
    const short = query.length > 50 ? `${query.slice(0, 47)}…` : query;
    return {
      line: query ? `Search /drive files for "${short}"` : 'Search /drive files (set a query first)',
      preview: { kind: 'db', details: { Query: short || '—', 'Max results': String(Number(config.topK ?? 5)) } },
    };
  },
  llmDescription:
    "Search the user's Drive files semantically — ground a workflow on documents the user has stored. Returns { query, results: [{ fileId, fileName, snippet, score, modality, chunkOrd }], count }, ranked by relevance (score = cosine similarity, higher is closer). Use this when the workflow needs to pull facts, quotes, or figures out of the user's uploaded files (reports, invoices, transcripts, photos) before summarising or sending. Text files match by meaning; images match by visual content + any OCR text; audio matches by transcript. Set fileTypes to restrict to a modality (e.g. \"image\" for photos only). Follow up with an llm-call to synthesise the passages, or feed results into a whatsapp/email node. Read-only — safe in dry runs.",
  llmExamples: [
    { query: '{{input.topic}}', topK: 5 },
    { query: 'quarterly revenue figures', topK: 8, fileTypes: 'text' },
    { query: 'photos of the garden in summer', topK: 6, fileTypes: 'image' },
  ],
};
