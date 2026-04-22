import type { NodeExecutor, NodeResult } from '../types';
import { interpolateTemplateStrict } from './template';
import { runScrape } from '$lib/workflows/scraper/runner';
import type { ScrapeJob } from '$lib/workflows/scraper/types';

export { webScrapeDef } from './web-scrape.def';

export const webScrapeExecutor: NodeExecutor = {
  type: 'web-scrape',

  async execute(input, config, context): Promise<NodeResult> {
    const url = interpolateTemplateStrict((config.url as string) || '', input).result;
    const profile = (config.profile as string) || 'default';
    const waitFor = config.waitFor as ScrapeJob['waitFor'];
    const extract = (config.extract as ScrapeJob['extract']) || [];
    const pagination = config.pagination as ScrapeJob['pagination'] | undefined;
    const credentialId = config.credentialId as number | undefined;
    const pacing = config.pacing as ScrapeJob['pacing'] | undefined;

    const result = await runScrape({
      url,
      profile,
      waitFor,
      extract,
      pagination,
      credentialId,
      pacing,
      workflowRunId: context.runId,
      onProgress: (ev) => {
        context.emit({
          type: 'scraper.progress',
          runId: context.runId,
          runLogId: 0,
          stage: (ev.t as any) ?? 'page.done',
          url: ev.url as string | undefined,
          pageIndex: ev.pageIndex as number | undefined,
          error: ev.error as string | undefined,
          timestamp: new Date().toISOString(),
        } as any);
      },
    });

    context.emit({
      type: 'scraper.run.finished',
      runId: context.runId,
      runLogId: result.runLogId ?? 0,
      success: result.success,
      pagesLoaded: result.pages.length,
      error: result.error,
      timestamp: new Date().toISOString(),
    } as any);

    return {
      output: {
        success: result.success,
        pages: result.pages,
        pageCount: result.pages.length,
        error: result.error,
        runLogId: result.runLogId,
      },
      metadata: { _selectedHandle: 'output' },
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              fields: { type: 'object' },
            },
          },
        },
        pageCount: { type: 'number' },
        error: { type: 'string' },
        runLogId: { type: 'number' },
      },
    };
  },
};
