import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { buildKnowledgeContext } from '$lib/jkai/intel/context';
import { intelQueryDef } from './intel-query.def';
export { intelQueryDef } from './intel-query.def';

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
      return { output: { ...input, intelContext: '', intelQuery: '' }, rowCount: 1 };
    }

    const context = await buildKnowledgeContext(query);
    return {
      output: {
        ...input,
        intelQuery: query,
        intelContext: context,
      },
      rowCount: 1,
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
