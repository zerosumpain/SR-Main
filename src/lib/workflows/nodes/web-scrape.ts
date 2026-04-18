import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { extractLocal } from '$lib/deepdive/extract-local';

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

export const webScrapeDef: NodeDefinition = {
  type: 'web-scrape',
  label: 'Web Scrape',
  category: 'integration',
  description: 'Fetch a URL and extract the readable article text using Mozilla Readability. Strips nav, ads, and chrome.',
  configSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to scrape. Supports {{input.field}} templates.' },
      maxChars: { type: 'number', description: 'Truncate text to this many characters (0 = no limit)' },
    },
    required: ['url'],
  },
  defaultConfig: { url: '', maxChars: 0 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Scraped content' }],
  basicConfig: [
    { key: 'url', label: 'URL', type: 'template-textarea', placeholder: 'https://example.com/article' },
    { key: 'maxChars', label: 'Max characters (0 = unlimited)', type: 'number', advancedOnly: true },
  ],
  llmDescription: 'Scrapes a web page and returns the main readable text (title + body prose), stripped of navigation/ads. Output is { url, success, title, text, length, truncated }. Use this when the workflow needs to read the content of a specific URL. For search-then-read flows, pair with tavily-search first. Access the extracted text via input.text on downstream nodes.',
  llmExamples: [
    { url: 'https://en.wikipedia.org/wiki/Svelte_(software)', maxChars: 5000 },
    { url: '{{input.url}}', maxChars: 0 },
  ],
};
