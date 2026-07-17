import type { NodeDefinition } from '../types';

export const dedupeDef: NodeDefinition = {
  type: 'dedupe',
  label: 'Dedupe',
  category: 'core',
  description:
    'Filter a list against a persistent seen-set so only genuinely new items continue downstream. Remembers ids across runs — the workflow never re-processes (or re-sends) the same item twice.',
  configSchema: {
    type: 'object',
    properties: {
      itemsPath: {
        type: 'string',
        description:
          'Dot-path to the array in the input (e.g. "results"). Leave empty to auto-detect the first array value.',
      },
      idPath: {
        type: 'string',
        description:
          'Dot-path to the unique id within each item (e.g. "url"). Empty → tries "url" then "id"; primitive items are their own id.',
      },
      storeKey: {
        type: 'string',
        description: 'data-store key holding the seen-id set (default "seen_ids").',
      },
      maxRemembered: {
        type: 'number',
        description: 'Cap the seen-set to the most recent N ids (default 500).',
      },
      recordMode: {
        type: 'string',
        enum: ['immediate', 'downstream-success'],
        description:
          "'immediate' records new ids as they pass through (default). 'downstream-success' records only after the whole run completes successfully — so a failed send does not mark items as seen.",
      },
    },
    required: [],
  },
  defaultConfig: {
    itemsPath: '',
    idPath: '',
    storeKey: 'seen_ids',
    maxRemembered: 500,
    recordMode: 'immediate',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Unseen items' }],
  summarize: (config) => {
    const storeKey = String(config.storeKey ?? 'seen_ids').trim() || 'seen_ids';
    const idPath = String(config.idPath ?? '').trim();
    return {
      line: `Keeps only items not seen before (key: ${storeKey}${idPath ? `, id: ${idPath}` : ''})`,
      preview: { kind: 'db', details: { Store: storeKey, Id: idPath || 'url → id' } },
    };
  },
  llmDescription:
    "Filters an array of items to only those NOT seen in a previous run, using a persistent seen-id set in the workflow data-store. This is the load-bearing node for recurring 'digest' / 'notify me about new X' workflows: place it BETWEEN the fetch/search node (tavily-search, http-request, rss, gmail-search, stealth-scrape) and the summarise/send nodes (llm-call → whatsapp / gmail-send / email) so only genuinely new items flow onward. The workflow then never re-summarises or re-sends the same story across daily runs. " +
    "Output: { items: [...only new...], newCount, seenCount, allItems: [...original...] } plus passthrough of the other top-level input keys. Downstream nodes should read `items` (the new ones) — e.g. skip sending when newCount is 0. " +
    "Config: itemsPath (dot-path to the array; auto-detects the first array if empty), idPath (unique id per item — default tries 'url' then 'id'), storeKey (default 'seen_ids'), maxRemembered (default 500 — rolling window), recordMode ('immediate' default, or 'downstream-success' to only remember items once the run's send steps succeed). " +
    "Prefer this node over hand-rolling data-store get/set dance — it does the atomic filter+record in one place.",
  llmExamples: [
    // Classic: dedupe web-search results by URL before summarising / sending.
    { itemsPath: 'results', idPath: 'url', storeKey: 'seen_urls', maxRemembered: 500 },
    // Only mark items seen once the downstream send has actually succeeded.
    { itemsPath: 'items', idPath: 'id', storeKey: 'sent_ids', recordMode: 'downstream-success' },
    // Auto-detect the array; fall back to url/id for the item key.
    { storeKey: 'seen_articles' },
  ],
};
