import type { NodeDefinition } from '../types';

/**
 * Dedicated RAG node over ALL deep-dive research sessions (cross-session
 * pgvector memory). Thin wrapper over the SAME `searchResearch` lib the
 * `research_search` site tool uses — a direct lib import (not the tool registry)
 * so the node returns a clean { results, count } shape. Read-only.
 */
export const researchSearchDef: NodeDefinition = {
  type: 'research-search',
  label: 'Research search (RAG)',
  category: 'integration',
  description:
    'Semantic search across the MATERIALS of every deep-dive research session at once — distilled facts AND raw source passages — ranked by meaning. Cross-session research memory for grounding a workflow.',
  configSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural-language description of what to find across past research. Supports {{input.field}} / {{state.KEY}} templates.',
      },
      topK: { type: 'number', description: 'Max passages to return, 1–30 (default 8).' },
    },
    required: ['query'],
  },
  defaultConfig: { query: '{{input.query}}', topK: 8 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Research passages' }],
  basicConfig: [
    {
      key: 'query',
      label: 'Search query',
      type: 'template-textarea',
      placeholder: 'what has my research turned up about school funding',
      description: 'What to find across all past deep-dive research. Supports {{input.field}} templates.',
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
  ],
  summarize: (config) => {
    const query = String(config.query ?? '').trim();
    const short = query.length > 50 ? `${query.slice(0, 47)}…` : query;
    return {
      line: query ? `Search research memory for "${short}"` : 'Search research memory (set a query first)',
      preview: { kind: 'db', details: { Query: short || '—', 'Max results': String(Number(config.topK ?? 8)) } },
    };
  },
  llmDescription:
    "Cross-session research memory. Semantic search over the MATERIALS of ALL past deep-dive research sessions at once — both the distilled facts and the raw source passages — searched by meaning, not keywords. Returns { query, results: [{ kind, snippet, score, sessionTopic, sourceTitle, sourceUrl, sessionId }], count }, where kind is \"fact\" (a distilled claim) or \"source\" (a raw source passage). Use this to ground a workflow in what earlier research actually found, when no single session is named — e.g. \"pull anything my research found about X\". Feed the passages into an llm-call to synthesise, or into a deck-build / whatsapp node. Read-only — safe in dry runs. To ask a question of ONE known session, use the deep-dive nodes instead.",
  llmExamples: [
    { query: '{{input.topic}}', topK: 8 },
    { query: 'evidence on the impact of tutoring on attainment', topK: 12 },
  ],
};
