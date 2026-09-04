import type { NodeDefinition } from '../types';

export const intelligenceDef: NodeDefinition = {
  type: 'intelligence',
  label: 'Intelligence',
  category: 'core',
  description:
    'Filtered view onto the knowledge graph. Queryable; emits both prose context and a structured IntelItem[].',
  configSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Query template. Supports {{input.field}}.' },
      facets: { type: 'object' },
    },
  },
  defaultConfig: {
    query: '',
    facets: { entityTypes: [], tags: [], timeRange: null, limit: 20, ordering: 'relevant' },
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Intelligence view' }],
  basicConfig: [
    {
      key: 'query',
      label: 'Query',
      type: 'template-textarea',
      description: 'What to look up. {{input.field}} placeholders supported.',
      placeholder: 'new projects',
      section: 'QUERY',
    },
  ],
  llmDescription: `Filtered view onto the personal intel knowledge graph. Like \`intel-query\` but also returns a structured \`intelItems\` array (+ \`intelCount\`) alongside the prose \`intelContext\`, and supports \`facets\` (entityTypes, tags, timeRange, ordering). Use when a downstream node needs to iterate over the matched items, not just read prose. Read-only.`,
  llmExamples: [{ query: 'recent projects' }, { query: '', facets: { tags: ['dfe'], ordering: 'recent' } }],
};
