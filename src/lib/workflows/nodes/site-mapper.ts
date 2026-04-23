import type { NodeExecutor, NodeResult } from '../types';
import { interpolateTemplateStrict } from './template';
import { runSiteMapper } from '$lib/workflows/scraper/site-mapper';

export { siteMapperDef } from './site-mapper.def';

export const siteMapperExecutor: NodeExecutor = {
  type: 'site-mapper',

  async execute(input, config, context): Promise<NodeResult> {
    const seedUrl = interpolateTemplateStrict((config.seedUrl as string) || '', input).result;
    const goal = interpolateTemplateStrict((config.goal as string) || '', input).result;
    const searchQuery = ((config.searchQuery as string) || '').trim() || undefined;
    const profile = (config.profile as string) || 'default';
    const model = ((config.model as string) || '').trim() || undefined;

    if (!seedUrl) throw new Error('site-mapper: seedUrl is required');
    if (!goal) throw new Error('site-mapper: goal is required');

    const result = await runSiteMapper({
      seedUrl,
      goal,
      searchQuery,
      profile,
      model,
      workflowRunId: context.runId,
      onProgress: (ev) => {
        context.emit({
          type: 'log',
          runId: context.runId,
          data: { kind: 'site-mapper', ...ev },
          timestamp: new Date().toISOString(),
        } as any);
      },
    });

    return {
      output: {
        domain: result.domain,
        playbook: result.playbook,
        validated: result.validated,
        itemCount: result.itemCount,
        firstItemSample: result.firstItemSample,
        error: result.error,
      },
      metadata: { _selectedHandle: 'output' },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in seedUrl / goal.' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        playbook: { type: 'object' },
        validated: { type: 'boolean' },
        itemCount: { type: 'number' },
        firstItemSample: { type: 'object' },
        error: { type: 'string' },
      },
    };
  },
};
