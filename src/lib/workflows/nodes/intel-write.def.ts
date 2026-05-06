import type { NodeDefinition } from '../types';

export const intelWriteDef: NodeDefinition = {
  type: 'intel-write',
  label: 'Intel Write',
  category: 'integration',
  description:
    'Add a note to the jkai/intel knowledge store. The note is extracted into entities + relationships, embedded for semantic search, and connected to the graph. Use for persisting findings (articles, summaries, observations) from a workflow so they contribute to future context and cross-reference alerts.',
  configSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Note title. Supports {{input.field}} templates. Optional — intel will derive one if blank.' },
      content: { type: 'string', description: 'Note body (markdown or plain text). Supports {{input.field}} templates. This is what gets extracted, embedded, and cross-referenced.' },
      format: {
        type: 'string',
        description: 'Content format: "summary" (default — LLM-produced brief), "text" (raw note), "email", "meeting_transcript".',
      },
      sourceTag: { type: 'string', description: 'Free-text source tag stored in metadata (e.g. workflow name, persona). Does not change dedup behaviour.' },
      sourceUrl: { type: 'string', description: 'Canonical URL the note was derived from (stored in metadata for provenance and dedup by callers).' },
      extraMetadata: { type: 'string', description: 'Optional JSON object merged into note metadata. Supports {{input.field}} templates.' },
    },
    required: ['content'],
  },
  defaultConfig: { title: '', content: '', format: 'summary', sourceTag: '', sourceUrl: '', extraMetadata: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Ingest result' }],
  basicConfig: [
    { key: 'title', label: 'Title', type: 'template-textarea', placeholder: 'e.g. {{input.headline}}', description: 'Optional. Falls back to the derived summary.' },
    { key: 'content', label: 'Content', type: 'template-textarea', placeholder: 'e.g. {{input.summary}}\n\nSource: {{input.url}}', description: 'The body of the note. This is what gets embedded and extracted.' },
    {
      key: 'format', label: 'Format', type: 'dropdown',
      description: 'Hint to the intel extractor about what kind of content this is.',
      options: [
        { value: 'summary', label: 'Summary (LLM brief)' },
        { value: 'text', label: 'Text' },
        { value: 'email', label: 'Email' },
        { value: 'meeting_transcript', label: 'Meeting transcript' },
      ],
    },
    { key: 'sourceTag', label: 'Source tag', type: 'template-textarea', placeholder: 'e.g. daily-briefing', description: 'Stored in metadata for filtering later.' },
    { key: 'sourceUrl', label: 'Source URL', type: 'template-textarea', placeholder: '{{input.url}}', description: 'Canonical URL for provenance.' },
    { key: 'extraMetadata', label: 'Extra metadata (JSON)', type: 'template-textarea', placeholder: '{ "persona": "researcher", "score": {{input.score}} }', description: 'Optional JSON merged into the note metadata.' },
  ],
  llmDescription:
    'Persists a note to the jkai/intel knowledge store. Returns { noteId, status }. Use this after an LLM synthesis step to contribute workflow findings to long-term intel (entities, graph, semantic search). Best paired with a deduplication gate (data-store) so the same article is not written twice. Processing (extraction + embedding) runs asynchronously — the node returns as soon as the note row is created and processing is kicked off.',
  llmExamples: [
    {
      title: '{{input.headline}}',
      content: '{{input.summary}}\n\nSource: {{input.url}}',
      format: 'summary',
      sourceTag: 'daily-briefing',
      sourceUrl: '{{input.url}}',
    },
  ],
};
