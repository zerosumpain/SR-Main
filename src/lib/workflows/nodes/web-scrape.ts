import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { extractLocal } from '$lib/deepdive/extract-local';

export { webScrapeDef } from './web-scrape.def';

export const webScrapeExecutor: NodeExecutor = {
  type: 'web-scrape',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const rawUrl = (config.url as string) || '';
    const url = interpolateTemplate(rawUrl, input).trim();

    if (!url) {
      throw new Error('web-scrape: url is required (supports {{input.field}} templates)');
    }

    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`web-scrape: url must start with http:// or https:// (got "${url}")`);
    }

    const result = await extractLocal(url);

    if (!result) {
      return {
        output: {
          url,
          success: false,
          error: 'Failed to fetch or no readable content found',
          title: null,
          text: '',
          length: 0,
        },
        rowCount: 1,
      };
    }

    const maxChars = Number(config.maxChars) || 0;
    const text = maxChars > 0 ? result.content.slice(0, maxChars) : result.content;

    return {
      output: {
        url: result.url,
        success: true,
        title: result.title,
        text,
        length: text.length,
        truncated: maxChars > 0 && result.content.length > maxChars,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for URL template interpolation (e.g. {{input.url}})' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL that was scraped' },
        success: { type: 'boolean', description: 'Whether readable content was extracted' },
        title: { type: 'string', description: 'Page title (nullable)' },
        text: { type: 'string', description: 'Extracted readable text content' },
        length: { type: 'number', description: 'Character count of text' },
        truncated: { type: 'boolean', description: 'Whether text was truncated by maxChars' },
        error: { type: 'string', description: 'Error message on failure' },
      },
    };
  },
};

