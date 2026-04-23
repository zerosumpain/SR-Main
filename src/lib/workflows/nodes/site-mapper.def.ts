import type { NodeDefinition } from '../types';

export const siteMapperDef: NodeDefinition = {
  type: 'site-mapper',
  category: 'integration',
  label: 'Site Mapper (LLM)',
  description:
    'One-shot: an LLM inspects the target website and writes a deterministic scraper ' +
    'playbook (URL template + wait condition + extract rules) into scraper_target_knowledge. ' +
    'Every future stealth-scrape run against that domain follows the playbook without ' +
    'another LLM call, so unattended cron runs stay fast and cheap.',
  defaultConfig: {
    seedUrl: '',
    goal: '',
    searchQuery: '',
    profile: 'default',
    model: '',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input (unused)' }],
  outputs: [{ name: 'output', type: 'object', label: 'Playbook + validation' }],
  configSchema: {
    type: 'object',
    required: ['seedUrl', 'goal'],
    properties: {
      seedUrl: {
        type: 'string',
        description: "Landing URL the mapper observes (e.g. the site's search page).",
      },
      goal: {
        type: 'string',
        description:
          'Plain-English description of what to extract — e.g. "data engineer job listings with title, organisation, salary, closing date, and link".',
      },
      searchQuery: {
        type: 'string',
        description:
          'Optional search term. Gets substituted into the playbook\'s urlTemplate via {{keyword}} during validation, so the mapper can confirm the playbook actually returns items.',
      },
      profile: {
        type: 'string',
        description: 'Scraper profile (shared with stealth-scrape nodes).',
      },
      model: {
        type: 'string',
        description: 'Optional LLM model id — empty uses the admin chat default.',
      },
    },
  },
  llmDescription:
    'Run this ONCE per new target domain to let an LLM generate a reusable scraper playbook. ' +
    'Wire a single run (not part of a schedule) — the output is saved into scraper_target_knowledge ' +
    'and all subsequent stealth-scrape nodes targeting the same domain will dispatch through it ' +
    'automatically. Output: { domain, playbook, validated, itemCount, firstItemSample, error? }.',
  basicConfig: [
    {
      key: 'seedUrl',
      label: 'Seed URL',
      type: 'template-textarea',
      placeholder: 'https://example.com/search',
      description: "The page the mapper loads first. Usually the site's search or listing page.",
    },
    {
      key: 'goal',
      label: 'Goal (what to extract)',
      type: 'template-textarea',
      placeholder: 'data engineer job listings with title, organisation, salary, closing date, link',
      description: 'Plain-English description the LLM uses to decide selectors + URL pattern.',
    },
    {
      key: 'searchQuery',
      label: 'Search query (optional)',
      type: 'text',
      placeholder: 'data engineer',
      description: 'Substituted into the playbook\'s {{keyword}} placeholder during validation.',
    },
    {
      key: 'profile',
      label: 'Profile Name',
      type: 'text',
      placeholder: 'default',
      description: 'Shared with stealth-scrape so cookies (e.g. cookie-consent) carry over.',
    },
  ],
};
