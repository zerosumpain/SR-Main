// src/lib/deepdive/chat-tools.ts
//
// `web_search` (workflow knit 2026-11-11, slice 3): a plain web search through
// the search balancer (`./web-search`), which picks the provider with credit
// left. It returns the result list itself, for a workflow step or a turn that
// wants pages to read rather than a written answer. `research_web_search`
// (grounded, a written summary) and `tavily_search` (Tavily by name) are
// untouched.
//
// Owner-only, not member-safe: it spends search credit. Registered from here
// (src/hooks.server.ts imports this module at boot).

import { register } from '$lib/tools/registry-internal';
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';

export const SNIPPET_CAP = 400;

register({
  name: 'web_search',
  description:
    'Search the web and get the result list: title, address and a snippet for each page, from whichever search provider has credit. Use when a step needs pages to read or links to hand on; for a written, sourced answer use research_web_search. Set news: true for recent news, with `days` to bound it. Read-only; spends a search credit.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search, in plain words.' },
      limit: { type: 'number', minimum: 1, maximum: 10, description: 'Most results. Default 6.' },
      news: { type: 'boolean', description: 'True to search recent news.' },
      days: { type: 'number', minimum: 1, maximum: 30, description: 'With news: how many days back.' },
    },
    required: ['query'],
  },
  category: 'Deep Dive Research',
  toolset: 'research',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('web_search', ctx);
    if (refused) return refused;
    const query = typeof args.query === 'string' ? args.query.trim().slice(0, 400) : '';
    if (!query) return { success: false, error: 'query is required.' };
    const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(10, Math.trunc(args.limit))) : 6;
    const news = args.news === true;
    const days = typeof args.days === 'number' && Number.isFinite(args.days) ? Math.max(1, Math.min(30, Math.trunc(args.days))) : undefined;
    try {
      const { search } = await import('./web-search');
      const out = await search(query, { purpose: 'tool.web_search', maxResults: limit, ...(news ? { topic: 'news' as const, ...(days ? { days } : {}) } : {}) });
      return {
        success: true,
        data: {
          query,
          provider: out.provider,
          results: out.results.slice(0, limit).map((r) => ({ title: r.title, url: r.url, snippet: (r.content ?? '').slice(0, SNIPPET_CAP) })),
        },
      };
    } catch (err) {
      return { success: false, error: `web_search failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
    }
  },
});
