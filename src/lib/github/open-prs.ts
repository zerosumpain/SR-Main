// src/lib/github/open-prs.ts
//
// "Is anything sitting on GitHub waiting for me?" — read-only, for the landing
// banner. Separate from pr.ts because that is the nightly engine's WRITE client
// (it commits and opens draft PRs, under its own user agent); nothing here can
// change anything on the repo.
//
// The banner it feeds is on the front door, and $lib/connectors/summary sets the
// standard for that surface: don't make an owner visit pay third-party latency.
// This one can't be a local read — the answer only exists on GitHub, and asking
// costs about 1.1s (one list call, then one per PR, measured 2026-08-16).
//
// So the page never waits for it. Reads return whatever is cached, immediately,
// and a stale cache triggers a refresh in the background for the next visit.
// The first load after a restart therefore shows no PR row, which is the right
// way round for a nudge: a second late is fine, a slow front page is not.

import { REPO_SLUG, githubConfigured, githubToken } from './issues';

const API = 'https://api.github.com';

/** How long a good answer is reused. Long enough that a burst of page loads
 *  costs one refresh; short enough that merging something clears the banner. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** A failure is remembered for less, so a transient outage self-heals. */
const ERROR_TTL_MS = 60 * 1000;
/** Per-request ceiling. The banner is a nicety; it never delays a page. */
const TIMEOUT_MS = 2500;
/** Mergeability is one call per PR, so cap how many we will ask about. */
const MAX_PRS_PROBED = 10;

export interface MergeablePrSummary {
  /** Open, non-draft PRs GitHub reports as cleanly mergeable. */
  count: number;
  /** Newest-first numbers, for the banner copy. */
  numbers: number[];
  /** Where to send the owner. */
  url: string;
}

interface PrListRow {
  number: number;
  draft: boolean;
}

let cache: { value: MergeablePrSummary | null; at: number; ttl: number } | null = null;
/** Coalesces concurrent misses onto one refresh. */
let inflight: Promise<void> | null = null;

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${githubToken()}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'strange-ramblings-landing',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: headers(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function fetchSummary(): Promise<MergeablePrSummary | null> {
  if (!githubConfigured()) return null;

  const open = await gh<PrListRow[]>(`/repos/${REPO_SLUG}/pulls?state=open&per_page=30`);
  const candidates = open.filter((p) => !p.draft).slice(0, MAX_PRS_PROBED);

  // `mergeable` is absent from the list endpoint — GitHub computes it per PR,
  // lazily, and reports `null` while it is still working. Unknown is treated as
  // not-mergeable rather than guessed: a banner that over-claims is worse than
  // one that catches up on the next refresh.
  const checked = await Promise.all(
    candidates.map((p) =>
      gh<{ number: number; mergeable: boolean | null }>(`/repos/${REPO_SLUG}/pulls/${p.number}`)
        .then((full) => (full.mergeable === true ? p.number : null))
        .catch(() => null),
    ),
  );

  const numbers = checked.filter((n): n is number => n !== null).sort((a, b) => b - a);
  return { count: numbers.length, numbers, url: `https://github.com/${REPO_SLUG}/pulls` };
}

/** Starts a refresh unless one is already running. Never rejects. */
function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetchSummary()
    .then((value) => {
      cache = { value, at: Date.now(), ttl: CACHE_TTL_MS };
    })
    .catch(() => {
      // Remember the failure briefly so an outage doesn't mean one GitHub call
      // per page load, but not for long enough to outlast a blip.
      cache = { value: null, at: Date.now(), ttl: ERROR_TTL_MS };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Count of open PRs that are ready to merge, from cache. Returns immediately —
 * never awaits GitHub — so `null` means "nothing cached yet", "GitHub is not
 * configured", or "the last refresh failed". Callers render nothing for all
 * three: the banner is a nudge, and being a page late is the correct failure.
 */
export function mergeablePrSummary(): MergeablePrSummary | null {
  const cached = cache;
  if (!cached || Date.now() - cached.at >= cached.ttl) void refresh();
  return cached?.value ?? null;
}

/** Test/admin hook — drops the cache so the next read goes to GitHub. */
export function invalidateMergeablePrCache(): void {
  cache = null;
}
