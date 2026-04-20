import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { buildKnowledgeContext } from '$lib/jkai/intel/context';

export const intelQueryExecutor: NodeExecutor = {
  type: 'intel-query',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const queryTemplate =
      typeof config.query === 'string' && config.query.trim()
        ? (config.query as string)
        : '{{input.message}}';
    const query = interpolateTemplate(queryTemplate, input).trim();

    if (!query) {
      return { output: { ...input, intelContext: '', intelQuery: '' } };
    }

    const context = await buildKnowledgeContext(query);
    return {
      output: {
        ...input,
        intelQuery: query,
        intelContext: context,
      },
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
      description: 'Passes input through with an added intelContext string and intelQuery.',
    };
  },
};

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
};
