import { register } from '../registry-internal';

register({
  name: 'scraper_target_knowledge_lookup',
  description:
    'Look up what we know about one or more domains before planning a scraper workflow. ' +
    'Returns knowledge including whether each domain requires an interactive-step upstream ' +
    '(for CAPTCHAs, login walls, cookie consent), verified CSS selectors, and free-form notes. ' +
    'ALWAYS call this before planning any stealth-scrape node for the given URLs.',
  parameters: {
    type: 'object',
    properties: {
      domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'URLs or hostnames to look up',
      },
    },
    required: ['domains'],
  },
  category: 'Scraper',
  toolset: 'scraper',
  handler: async (args) => {
    const { lookupByDomains } = await import('$lib/workflows/scraper/target-knowledge');
    const domains = args.domains as string[];
    const results = await lookupByDomains(domains);
    return { success: true, data: results };
  },
});
