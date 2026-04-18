import type { NodeDefinition } from '../types';

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
    {
      key: 'url', label: 'URL', type: 'template-textarea',
      placeholder: 'https://example.com/article',
      description: 'Web page to fetch. Must start with http:// or https://. Supports {{input.field}} templates.',
    },
    {
      key: 'maxChars', label: 'Max Characters', type: 'number', min: 0,
      section: 'ADVANCED',
      description: 'Truncate extracted text to this many characters. 0 = no limit.',
      advancedOnly: true,
    },
  ],
  llmDescription: 'Scrapes a web page and returns the main readable text (title + body prose), stripped of navigation/ads. Output is { url, success, title, text, length, truncated }. Use this when the workflow needs to read the content of a specific URL. For search-then-read flows, pair with tavily-search first. Access the extracted text via input.text on downstream nodes.',
  llmExamples: [
    { url: 'https://en.wikipedia.org/wiki/Svelte_(software)', maxChars: 5000 },
    { url: '{{input.url}}', maxChars: 0 },
  ],
};
