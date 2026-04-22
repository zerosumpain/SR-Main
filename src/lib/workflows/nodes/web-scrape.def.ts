import type { NodeDefinition } from '../types';

export const webScrapeDef: NodeDefinition = {
  type: 'web-scrape',
  category: 'data',
  label: 'Web Scrape',
  description: 'Scrape a web page (or paginated set) using a stealth headless browser with a persistent profile. Residential IP via homeserv.',
  configSchema: {
    type: 'object',
    required: ['url', 'profile', 'waitFor', 'extract'],
    properties: {
      url: { type: 'string', description: 'Starting URL (supports {{input.x}} templates)' },
      profile: { type: 'string', description: 'Per-domain profile name, e.g. civilservicejobs-gov-uk' },
      waitFor: {
        oneOf: [
          { type: 'object', properties: { type: { const: 'networkidle' } } },
          { type: 'object', properties: { type: { const: 'selector' }, selector: { type: 'string' }, timeoutMs: { type: 'number' } } },
          { type: 'object', properties: { type: { const: 'timeout' }, ms: { type: 'number' } } },
        ],
      },
      extract: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            selector: { type: 'string' },
            attr: { type: 'string', default: 'text' },
            multi: { type: 'boolean' },
            trim: { type: 'boolean' },
            regex: { type: 'string' },
          },
          required: ['field', 'selector'],
        },
      },
      pagination: {
        oneOf: [
          {
            type: 'object',
            properties: {
              type: { const: 'next-link' },
              nextSelector: { type: 'string' },
              maxPages: { type: 'number' },
            },
            required: ['type', 'nextSelector', 'maxPages'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'url-template' },
              template: { type: 'string', description: 'e.g. https://site?page={n}' },
              start: { type: 'number' },
              maxPages: { type: 'number' },
            },
            required: ['type', 'template', 'start', 'maxPages'],
          },
        ],
      },
      credentialId: { type: 'number', description: 'Row id in scraper_credentials' },
      pacing: {
        type: 'object',
        properties: { minMs: { type: 'number' }, maxMs: { type: 'number' } },
      },
    },
  },
};
