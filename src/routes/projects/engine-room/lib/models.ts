// models.ts — content for the Models section: how a model is chosen, what you are actually
// buying when you name one, and where the money goes.
//
// Figures come from the routing code, its tests, and live calls to the gateway's public
// endpoints listing. Catalogue counts are from a catalogue snapshot, and are labelled as
// such — they describe the shape of the market, not a production state.

export interface Layer {
  n: string;
  name: string;
  what: string;
  eli5: string;
  when: string;
}

/** The four-layer resolution chain. First match wins. */
export const RESOLUTION: Layer[] = [
  {
    n: '1', name: 'A hand pin',
    what: 'An explicit model set on this specific call or node, by a person, because they had a reason.',
    eli5: 'Someone chose this one by hand.',
    when: 'Rare. Used when a particular job needs a particular model and nothing else will do.',
  },
  {
    n: '2', name: 'The nightly auction',
    what: 'A profile — general, tool-use, retrieval or agentic — resolved to whichever model won last night’s scoring run over the whole catalogue.',
    eli5: 'Whichever AI won last night’s contest for this kind of job.',
    when: 'The interesting path. Runs at 04:00 Europe/London against price, capability and observed success.',
  },
  {
    n: '3', name: 'A named carve-out',
    what: 'Three unattended pipelines pin their own model with the reasoning written at the constant, so an overnight job cannot silently change behaviour when a preference moves.',
    eli5: 'Jobs that run while nobody is watching always use the same AI on purpose.',
    when: 'Self-improvement, the workflow doctor, and the builder.',
  },
  {
    n: '4', name: 'The site default',
    what: 'One value, resolved from settings, that everything else falls back to. Sixty-one files reach for it; exactly two places construct a client.',
    eli5: 'The normal one, used unless something says otherwise.',
    when: 'Everything not covered above.',
  },
];

export interface Seller {
  id: string;
  quant: 'fp8' | 'fp4' | 'unknown';
  inPrice: number;   // $ per million input tokens
  ttft: number;      // seconds, representative
  note?: string;
}

/** A representative spread of sellers behind ONE model id. Prices and the quantisation mix
 *  reflect a live endpoints listing; individual seller names are deliberately not used. */
export const SELLERS: Seller[] = [
  { id: 'Seller A', quant: 'fp4', inPrice: 0.28, ttft: 52.9, note: 'cheapest per token, and the one a naive sort picks' },
  { id: 'Seller B', quant: 'fp4', inPrice: 0.31, ttft: 18.4 },
  { id: 'Seller C', quant: 'unknown', inPrice: 0.44, ttft: 9.1, note: 'precision not advertised' },
  { id: 'Seller D', quant: 'fp8', inPrice: 0.62, ttft: 3.6 },
  { id: 'Seller E', quant: 'fp8', inPrice: 0.88, ttft: 1.5, note: 'full precision, fast, and still nowhere near the ceiling' },
  { id: 'Seller F', quant: 'fp8', inPrice: 2.31, ttft: 2.4, note: 'most expensive — and not the fastest' },
];

export const SELLER_FACTS = {
  endpointsDefault: 21,
  endpointsAgentic: 32,
  mixDefault: { fp8: 9, unknown: 7, fp4: 5 },
  priceSpread: '8.2×',
  latencyNulls: '32 of 32',
  uptimeAvailable: '29 of 32',
};

/** The measured five-call trace that killed the "long prompt = slow" theory. */
export const TTFT_TRACE = [
  { call: 1, promptTokens: 18_400, ttft: 3.6 },
  { call: 2, promptTokens: 21_900, ttft: 2.5 },
  { call: 3, promptTokens: 20_667, ttft: 52.9 },
  { call: 4, promptTokens: 20_100, ttft: 1.5 },
  { call: 5, promptTokens: 19_800, ttft: 1.5 },
];

/** max_tokens vs what a reasoning model actually returns. Measured on the site default. */
export const REASONING_ROWS = [
  { budget: 50, finish: 'length', reasoning: 50, output: '', verdict: 'Empty string. No error, no warning — it spent the entire budget thinking.' },
  { budget: 3_000, finish: 'stop', reasoning: 447, output: 'tool', verdict: 'One word, after 447 tokens of invisible reasoning you paid for.' },
];

export const POLICY = [
  { k: 'Price weight, capped at', v: '0.5', why: 'Uncapped, cost dominates every other axis and the auction degenerates.' },
  { k: 'Open-weight bonus', v: '×1.15', why: 'A deliberate thumb on the scale toward models that are not a single vendor’s to withdraw.' },
  { k: 'Success bias', v: 'k = 0.2', why: 'Observed success nudges the ranking; it does not decide it.' },
  { k: 'Prior for unrated models', v: '0.6', why: 'Slightly below average, so an unknown has to earn its place rather than win by default.' },
  { k: 'Price ceiling', v: '$15 / M', why: 'A hard stop. Nothing above this enters the pool regardless of how good it scores.' },
  { k: 'Minimum context', v: '32,000', why: 'Below this the toolkit alone will not fit, so the model cannot do the job at all.' },
];

export const CATALOGUE = {
  total: 338,
  toolCapable: 267,
  rated: 103,
  eligible: 94,
  pools: { general: 16, tool: 16, rag: 31, agentic: 12 },
  withThroughput: 0,
  lowCeiling: 76,
};

export const CACHE_STORY = {
  before: 'Cache breakpoints were only being sent for one vendor’s models. Every other model in the catalogue was re-reading — and being charged full price for — an identical prefix on every single turn.',
  after: 'The marking was made unconditional. The prefix is the same bytes it always was; the only change was telling the provider so.',
  lesson: 'The saving was not an optimisation of the prompt. It was the discovery that a saving already available was not being claimed, on every model but one.',
};
