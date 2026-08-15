/**
 * Whether — and how — an `instant` answer is allowed to consult the web.
 *
 * `instant` exists to answer in seconds from what the model already knows, and
 * its prompt says so out loud. That honesty was the whole tier: no sources, no
 * search, and a standing instruction never to invent a citation. Measured
 * 2026-08-15, it does invent them anyway — asked for the current Node.js
 * release with search off, Codex answered with a github.com release URL it had
 * never fetched. Grounding is the fix for that, and the three routes below buy
 * it at genuinely different prices.
 *
 * Every number here was measured on the same question on 2026-08-15, not
 * quoted from a datasheet:
 *
 * | route  | latency | cash/run | streams | citations                    |
 * |--------|---------|----------|---------|------------------------------|
 * | `off`  | ~8s     | ~$0.02   | yes     | none, and may fabricate one  |
 * | `fast` | ~17s    | ~$0.15   | yes     | annotations, redirect URLs   |
 * | `free` | ~25-32s | $0       | coarse  | real URLs, as fetched        |
 *
 * `fast` is OpenRouter's web plugin on the tier's pinned model; $0.126 of that
 * $0.15 is the grounding fee, not the answer. `free` is Codex live search over
 * the ChatGPT subscription — no cash, real quota, and slower because Codex
 * itself is slow: with search OFF it still measured 27s.
 *
 * Cached search is deliberately not offered. It looked like a cheap `live` and
 * returned a version a week stale while stating it as current, which is worse
 * than not searching at all.
 */

export const GROUNDING_MODES = ['off', 'fast', 'free'] as const;
export type Grounding = (typeof GROUNDING_MODES)[number];

export function coerceGrounding(value: unknown): Grounding {
  return typeof value === 'string' && (GROUNDING_MODES as readonly string[]).includes(value)
    ? (value as Grounding)
    : 'off';
}

export interface GroundingOption {
  mode: Grounding;
  label: string;
  /** What the reader is choosing, in one line. */
  blurb: string;
  /** Measured, not promised. */
  seconds: number;
  /** Cash per run in USD. Zero for the subscription route. */
  costUsd: number;
  cites: boolean;
}

export const GROUNDING_OPTIONS: GroundingOption[] = [
  {
    mode: 'off',
    label: 'No search',
    blurb: 'The model answers from training data. Fastest and nearly free, but it cannot cite anything and may be out of date.',
    seconds: 8,
    costUsd: 0.02,
    cites: false,
  },
  {
    mode: 'fast',
    label: 'Search, fast',
    blurb: 'Grounded and still streams as it writes. Costs about fifteen cents a run, most of it a search fee rather than the answer.',
    seconds: 17,
    costUsd: 0.15,
    cites: true,
  },
  {
    mode: 'free',
    label: 'Search, free',
    blurb: 'Grounded against the ChatGPT subscription, so no cash cost — but it takes about half a minute and arrives in chunks rather than word by word.',
    seconds: 32,
    costUsd: 0,
    cites: true,
  },
];

export function groundingOption(mode: Grounding): GroundingOption {
  return GROUNDING_OPTIONS.find((o) => o.mode === mode) ?? GROUNDING_OPTIONS[0];
}

/**
 * True when the run consulted the web at all.
 *
 * A type predicate, so a caller that has ruled out `off` is left holding one of
 * the two search routes — `groundedCompletion` takes exactly those, and without
 * the narrowing every call site would need a cast that could hide a real
 * mistake later.
 */
export function isGrounded(mode: Grounding): mode is Exclude<Grounding, 'off'> {
  return mode !== 'off';
}

/**
 * One citation, however the provider phrased it.
 *
 * Both routes emit OpenAI-shaped `url_citation` annotations — the Codex bridge
 * does so deliberately, so that a single reader serves both. `title` is present
 * on the OpenRouter side and absent on the Codex side; neither is required.
 */
export interface Citation {
  url: string;
  title?: string | null;
}

/**
 * Pull citations out of a completion message, whichever provider produced it.
 *
 * Defensive by design: this reads a field that is not in the OpenAI SDK's types
 * on either path, so anything unexpected is skipped rather than thrown over.
 */
export function readCitations(message: unknown): Citation[] {
  const anns = (message as { annotations?: unknown } | null)?.annotations;
  if (!Array.isArray(anns)) return [];
  const out: Citation[] = [];
  for (const a of anns) {
    const c = (a as { url_citation?: { url?: unknown; title?: unknown } } | null)?.url_citation;
    const url = typeof c?.url === 'string' ? c.url.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) continue;
    out.push({ url, title: typeof c?.title === 'string' ? c.title : null });
  }
  return out;
}

/**
 * Google's grounding puts every citation behind a redirect.
 *
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/<opaque>` is what
 * arrives, and storing that as a source would fill the list with one
 * meaningless host, defeat the media classifier, and hand the /drive archiver a
 * URL it cannot usefully fetch. The redirects do resolve — verified 2026-08-15,
 * one became a herodevs.com article — so they are followed once, here, and the
 * real URL is what gets stored.
 */
export function isRedirectCitation(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('vertexaisearch.cloud.google.com');
  } catch {
    return false;
  }
}
