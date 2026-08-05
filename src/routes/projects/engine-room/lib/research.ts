// research.ts — content for the Research section: gathering sources, keeping provenance,
// and the structural change that stops a summary inventing things.

export interface Source { id: string; name: string; claims: string[] }

/** A deliberately ordinary example: three sources that agree on some things, differ on
 *  others, and are silent on the thing the reader most wants to know. */
export const SOURCES: Source[] = [
  { id: 'a', name: 'Source A — a regulator’s annual report', claims: [
    'The scheme covered 1.2 million households in its first year.',
    'Take-up was highest in urban areas.',
  ]},
  { id: 'b', name: 'Source B — a research institute', claims: [
    'Take-up was highest in urban areas.',
    'Administrative costs ran to about 4% of the budget.',
  ]},
  { id: 'c', name: 'Source C — a newspaper analysis', claims: [
    'The scheme covered "well over a million" households.',
    'Critics argue the rural rollout was underfunded.',
  ]},
];

/** What a merge-then-summarise pass produces. Every sentence reads well; the provenance is
 *  gone, and one sentence is in none of the sources. */
export const MERGED = [
  { text: 'The scheme reached 1.2 million households, with take-up concentrated in cities.', status: 'ok' as const, note: 'True, but you can no longer tell which source said what.' },
  { text: 'Administrative costs were around 4%.', status: 'ok' as const, note: 'True — and now indistinguishable in status from the sentence below.' },
  { text: 'Rural underfunding contributed to the urban–rural gap in take-up.', status: 'invented' as const, note: 'No source says this. Two nearby facts — an urban skew, and a criticism about rural funding — have been fused into a causal claim nobody made.' },
];

/** What a facts-then-compose pass produces. */
export const EXTRACTED = [
  { text: 'The scheme covered 1.2 million households in its first year.', from: ['a'], conf: 'high' as const },
  { text: 'Take-up was highest in urban areas.', from: ['a', 'b'], conf: 'high' as const },
  { text: 'Administrative costs ran to about 4% of the budget.', from: ['b'], conf: 'medium' as const },
  { text: 'Critics argue the rural rollout was underfunded.', from: ['c'], conf: 'medium' as const },
];

export const GAPS = [
  'No source states a cause for the urban–rural difference in take-up.',
  'Source C’s household figure is imprecise and may or may not corroborate Source A’s.',
  'No source covers the second year.',
];

export const RESEARCH_FACTS = [
  { k: 'Sources are gathered, then read', why: 'Searching returns links; the useful content is behind them. A separate extraction step reads each page properly rather than reasoning from a snippet.' },
  { k: 'Facts are extracted individually', why: 'Each claim becomes its own record with its own date, its own confidence, and its own source — before anything tries to write prose.' },
  { k: 'Entities are recognised as it goes', why: 'People and organisations found while researching flow into the same knowledge graph the rest of the system uses. Research is not a dead end.' },
  { k: 'Citations survive to the answer', why: 'The composed answer carries markers back to the passages, so a reader can check any sentence rather than trusting the whole.' },
];

export const CONNECTOR_LESSON = {
  title: 'Never trust a stored status column',
  body: 'A dashboard showing whether each connected service is healthy is very easy to build wrongly: write a status when something succeeds or fails, then display that column. It is then perfectly possible for a connection to have died six weeks ago while the dashboard cheerfully reports the last thing that happened to work.',
  fix: 'Health has to be derived at read time from evidence with a timestamp — when did this last actually succeed, and how long ago was that — rather than read from a field somebody wrote once. A status column records history; a dashboard implies the present tense.',
};

export const SEARCH_LESSON = {
  title: 'The tool worked. The preview did not.',
  body: 'A search tool appeared to be returning nothing. It was not: the results were nested under a key that the truncated preview of the tool’s output cut off before reaching. The tool was fine, the data was there, and the only broken thing was how much of the result was being shown.',
  fix: 'When a tool "returns nothing", check what you are looking at before you check what it returned. A preview is a rendering, and a rendering can lie about the thing it renders.',
};
