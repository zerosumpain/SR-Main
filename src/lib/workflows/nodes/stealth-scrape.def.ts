import type { NodeDefinition } from '../types';

export const stealthScrapeDef: NodeDefinition = {
  type: 'stealth-scrape',
  category: 'integration',
  label: 'Stealth Scrape',
  description: 'Scrape a web page (or paginated set) using a stealth headless browser with a persistent profile. Residential IP via homeserv.',
  defaultConfig: {
    url: '',
    profile: '',
    waitFor: { type: 'networkidle' },
    extract: [],
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Scrape result' }],
  configSchema: {
    type: 'object',
    required: ['url', 'profile', 'waitFor', 'extract'],
    properties: {
      url: { type: 'string', description: 'Starting URL (supports {{input.x}} templates)' },
      profile: { type: 'string', description: 'Per-domain profile name, e.g. civilservicejobs-gov-uk' },
      waitFor: {
        type: 'object',
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
        type: 'object',
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
  llmDescription: 'Scrapes a single page or paginated set using headless Chromium with stealth patches and a persistent profile. When scraping a new or unfamiliar domain — or any site with CAPTCHAs, cookie consent, login walls, or known bot-detection (Cloudflare/Akamai/etc.) — place an `interactive-step` node UPSTREAM sharing the same `profile` value. The human solves the wall once on first run; subsequent headless runs ride the seeded cookies. If you\'re confident the target is bare (e.g. news.ycombinator.com, static docs, public JSON-style pages) you can omit the interactive-step — but false negatives (missing it) fail harder than false positives (one unnecessary human click). Pair with `stealth-scrape-llm` downstream when CSS selectors are too brittle. Profile names should be stable per-domain (e.g. `civilservicejobs-gov-uk`) so cookies persist across runs. Output shape: { pages: [{ url, fields: {}, html, text }], pagesLoaded, profile }.',
  llmExamples: [
    {
      url: 'https://www.civilservicejobs.service.gov.uk/csr/jobs.cgi',
      profile: 'civilservicejobs-gov-uk',
      waitFor: { type: 'networkidle' },
      extract: [
        { field: 'title', selector: 'h3.search-results-job-box-title', multi: true },
        { field: 'link', selector: 'h3.search-results-job-box-title a', attr: 'href', multi: true },
      ],
      pagination: { type: 'next-link', nextSelector: 'a.next', maxPages: 5 },
    },
    {
      url: '{{input.searchUrl}}',
      profile: 'target-site',
      waitFor: { type: 'selector', selector: '.results-list', timeoutMs: 10000 },
      extract: [
        { field: 'items', selector: '.result-item', multi: true },
      ],
    },
    {
      url: 'https://news.ycombinator.com',
      profile: 'hn',
      waitFor: { type: 'networkidle' },
      extract: [
        { field: 'titles', selector: '.titleline > a', multi: true },
        { field: 'scores', selector: '.score', multi: true },
      ],
    },
  ],
  basicConfig: [
    {
      key: 'url',
      label: 'URL',
      type: 'template-textarea',
      placeholder: 'https://example.com/search?q=jobs',
      description: 'Starting URL. Supports {{input.field}} templates.',
    },
    {
      key: 'profile',
      label: 'Profile Name',
      type: 'text',
      placeholder: 'example-com',
      description: 'Stable per-domain identifier. Cookies and session data persist under this name. Must match the interactive-step profile if used.',
    },
    {
      key: 'extract',
      label: 'Extract Fields',
      type: 'code',
      description: 'Array of {field, selector, attr?, multi?, trim?} objects defining what to pull from each page.',
    },
    {
      key: 'waitFor',
      label: 'Wait Condition',
      type: 'code',
      description: '{type: "networkidle"} | {type: "selector", selector: ".foo"} | {type: "timeout", ms: 2000}',
    },
    {
      key: 'pagination',
      label: 'Pagination',
      type: 'code',
      description: 'Optional. {type: "next-link", nextSelector: "a.next", maxPages: 5} or {type: "url-template", template: "https://site?page={n}", start: 1, maxPages: 10}',
      section: 'ADVANCED',
      advancedOnly: true,
    },
    {
      key: 'credentialId',
      label: 'Login Credential',
      type: 'number',
      description: 'Row id from scraper_credentials table if the site requires form login.',
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
};
