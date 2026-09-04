import type { NodeDefinition } from '../types';

export const intelQueryDef: NodeDefinition = {
  type: 'intel-query',
  label: 'Intel Query',
  category: 'core',
  description:
    'Search the intel knowledge graph; appends matching context as intelContext to downstream input.',
  configSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Query template. Supports {{input.field}} placeholders.',
      },
    },
  },
  defaultConfig: { query: '{{input.message}}' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Output w/ intel context' }],
  basicConfig: [
    {
      key: 'query',
      label: 'Query',
      type: 'template-textarea',
      description: 'What to look up. {{input.field}} placeholders supported.',
      placeholder: '{{input.message}}',
      section: 'QUERY',
    },
  ],
  llmDescription: `Search the personal intel knowledge graph and append the matching context as an \`intelContext\` string onto the passed-through input. Use to enrich a downstream LLM prompt with what the site already knows about the query. Read-only; prose output only. For structured items + facets use the \`intelligence\` node instead.`,
  llmExamples: [{ query: '{{input.message}}' }, { query: 'projects related to {{input.topic}}' }],
};
