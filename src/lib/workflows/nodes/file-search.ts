import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { searchFiles } from '$lib/file-index/search';

export { fileSearchDef } from './file-search.def';

/** Parse the comma-separated modality filter into a lowercased set (empty = no filter). */
function parseModalities(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const fileSearchExecutor: NodeExecutor = {
  type: 'file-search',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const query = interpolateTemplate(String(config.query ?? ''), input).trim();
    if (!query) {
      throw new Error('file-search: query is required (supports {{input.field}} templates)');
    }

    const topKRaw = Number(config.topK);
    const topK = Number.isFinite(topKRaw) ? Math.min(Math.max(Math.floor(topKRaw), 1), 30) : 5;
    const modalities = parseModalities(config.fileTypes);

    // Over-fetch when a modality filter is set so the post-filter can still
    // return up to topK matches; searchFiles caps at 30 internally.
    const fetchK = modalities.length ? Math.min(topK * 4, 30) : topK;
    const hits = await searchFiles(query, { topK: fetchK });

    const filtered = (modalities.length
      ? hits.filter((h) => modalities.includes(h.modality.toLowerCase()))
      : hits
    ).slice(0, topK);

    const results = filtered.map((h) => ({
      fileId: h.fileId,
      fileName: h.source,
      snippet: h.passage,
      score: h.score,
      modality: h.modality,
      chunkOrd: h.chunkOrd,
    }));

    return {
      output: { query, results, count: results.length },
      rowCount: results.length,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for {{input.*}} interpolation in the query' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The executed search query' },
        results: { type: 'array', description: 'Ranked passages: { fileId, fileName, snippet, score, modality, chunkOrd }' },
        count: { type: 'number', description: 'Number of passages returned' },
      },
    };
  },
};
