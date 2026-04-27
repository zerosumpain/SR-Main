import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { searchIntel, type IntelFacets, type IntelItem } from '$lib/jkai/intel/search';
import { buildKnowledgeContext } from '$lib/jkai/intel/context';

type StoredFacets = {
  entityTypes?: string[];
  tags?: string[];
  timeRange?: { from: string; to: string } | null;
  limit?: number;
  ordering?: 'recent' | 'relevant';
};

export const intelligenceExecutor: NodeExecutor = {
  type: 'intelligence',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const queryTemplate = typeof config.query === 'string' ? (config.query as string) : '';
    const query = interpolateTemplate(queryTemplate, input).trim();

    const rawFacets = (config.facets ?? {}) as StoredFacets;
    const facets: IntelFacets = {
      entityTypes: rawFacets.entityTypes ?? [],
      tags: rawFacets.tags ?? [],
      timeRange: rawFacets.timeRange ?? null,
      limit: typeof rawFacets.limit === 'number' ? rawFacets.limit : 20,
      ordering: rawFacets.ordering ?? 'relevant',
    };

    const hasAnyFacet =
      (facets.entityTypes?.length ?? 0) > 0 ||
      (facets.tags?.length ?? 0) > 0 ||
      facets.timeRange != null;

    if (!query && !hasAnyFacet) {
      return {
        output: {
          ...input,
          intelQuery: '',
          intelFocus: {
            query: '',
            entityTypes: facets.entityTypes ?? [],
            tags: facets.tags ?? [],
            timeRange: facets.timeRange ?? null,
            ordering: facets.ordering ?? 'relevant',
          },
          intelContext: '',
          intelItems: [] as IntelItem[],
          intelCount: 0,
        },
        rowCount: 1,
      };
    }

    const [{ items, total }, context] = await Promise.all([
      searchIntel(query, facets),
      query ? buildKnowledgeContext(query) : Promise.resolve(''),
    ]);

    return {
      output: {
        ...input,
        intelQuery: query,
        intelFocus: {
          query,
          entityTypes: facets.entityTypes ?? [],
          tags: facets.tags ?? [],
          timeRange: facets.timeRange ?? null,
          ordering: facets.ordering ?? 'relevant',
        },
        intelContext: context,
        intelItems: items,
        intelCount: total,
      },
      rowCount: items.length || 1,
    };
  },

  getInputSchema() {
    return {
      type: 'object',
      description: 'Upstream payload. Query template can reference {{input.*}} fields.',
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description:
        'Adds intelQuery, intelFocus, intelContext (prose), intelItems (array), intelCount.',
    };
  },
};

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
};
