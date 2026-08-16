// src/lib/github/open-prs.ts
//
// "Is anything sitting on GitHub waiting for me?" — read-only, for the landing
// banner. Separate from pr.ts because that is the nightly engine's WRITE client
// (it commits and opens draft PRs, under its own user agent); nothing here can
// change anything on the repo.
//
// The banner it feeds is on the front door, and $lib/connectors/summary sets the
// standard for that surface: don't make an owner visit pay third-party latency.
// This one can't be a local read — the answer only exists on GitHub — so it is
// cached and refreshed in the background: a warm or stale cache is served
// instantly and never blocks. The single exception is a cold cache, which waits
// up to FIRST_LOAD_BUDGET_MS once per process, because "nothing yet" and "no PRs
// are ready" render identically and the blank first load reads as a fault.
//
// GraphQL, not REST, and the reason matters. REST's list endpoint omits
// `mergeable` entirely; the per-PR endpoint has it but computes it lazily and
// answers `null` until it is done — for PR #276 it stayed `null` across repeated
// calls, so the first shipped version of this file counted zero mergeable PRs
// forever and the banner never appeared (2026-08-16). The GraphQL *list* query
// returns the settled verdict for every open PR in one request. Note the shape
// matters as much as the protocol: GraphQL for a SINGLE pull request returns
// UNKNOWN the same way REST does.

import { REPO_SLUG, githubConfigured, githubToken } from './issues';

const API = 'https://api.github.com';

/** How long a good answer is reused. Long enough that a burst of page loads
 *  costs one refresh; short enough that merging something clears the banner. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** A failure is remembered for less, so a transient outage self-heals. */
const ERROR_TTL_MS = 60 * 1000;
/** Per-request ceiling. The banner is a nicety; it never delays a page. */
const TIMEOUT_MS = 5000;
/** A merge check genuinely in flight settles in a second or two. One retry,
 *  which costs nothing here because this runs off the request path. */
const UNKNOWN_RETRY_MS = 2000;
/** How long the FIRST load on a cold cache will wait before giving up and
 *  rendering nothing. One GraphQL call is ~300ms; this is the ceiling, paid
 *  once per process, never on a warm or stale-but-present cache. */
const FIRST_LOAD_BUDGET_MS = 900;

export interface MergeablePrSummary {
  /** Open, non-draft PRs GitHub reports as cleanly mergeable. */
  count: number;
  /** Newest-first numbers, for the banner copy. */
  numbers: number[];
  /** Where to send the owner. */
  url: string;
}

/** GitHub's merge check: settled yes, settled no, or still thinking. */
type Mergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

interface PrNode {
  number: number;
  isDraft: boolean;
  mergeable: Mergeable;
}

const OPEN_PRS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 30, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { number isDraft mergeable }
    }
  }
}`;

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

async function queryOpenPrs(): Promise<PrNode[]> {
  const [owner, name] = REPO_SLUG.split('/');
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: OPEN_PRS_QUERY, variables: { owner, name } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL failed: ${res.status}`);
  const body = (await res.json()) as {
    data?: { repository?: { pullRequests?: { nodes?: PrNode[] } } };
    errors?: Array<{ message: string }>;
  };
  // GraphQL answers 200 with an `errors` array, so a bad token or a renamed
  // repo would otherwise read as "no open PRs" rather than as a failure.
  if (body.errors?.length) throw new Error(`GitHub GraphQL: ${body.errors[0].message}`);
  return body.data?.repository?.pullRequests?.nodes ?? [];
}

async function fetchSummary(): Promise<MergeablePrSummary | null> {
  if (!githubConfigured()) return null;

  let nodes = await queryOpenPrs();

  // UNKNOWN means the merge check is still running — usually right after a push.
  // Ask once more rather than banking a zero for the whole cache window; if the
  // second answer is no better, UNKNOWN counts as not-mergeable, because a
  // banner that over-claims is worse than one that catches up next refresh.
  if (nodes.some((n) => !n.isDraft && n.mergeable === 'UNKNOWN')) {
    await new Promise((resolve) => setTimeout(resolve, UNKNOWN_RETRY_MS));
    nodes = await queryOpenPrs().catch(() => nodes);
  }

  const numbers = nodes
    .filter((n) => !n.isDraft && n.mergeable === 'MERGEABLE')
    .map((n) => n.number)
    .sort((a, b) => b - a);
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
 * Count of open PRs that are ready to merge.
 *
 * A warm cache answers instantly and refreshes in the background. A cold one —
 * first owner visit after a restart, so a few times a day on a deploy-heavy
 * repo — waits, but only up to `FIRST_LOAD_BUDGET_MS`, and only that once. The
 * alternative was showing nothing on the first load, which is indistinguishable
 * from "no PRs are ready" and reads as a broken banner.
 *
 * `null` means not configured, refresh failed, or the first load ran out of
 * patience. Callers render nothing for all three.
 */
export async function mergeablePrSummary(): Promise<MergeablePrSummary | null> {
  const cached = cache;
  if (cached && Date.now() - cached.at < cached.ttl) return cached.value;

  const pending = refresh();
  if (cached) return cached.value; // stale but real — serve it, let the refresh land
  await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, FIRST_LOAD_BUDGET_MS))]);
  return cache?.value ?? null;
}

/** Test/admin hook — drops the cache so the next read goes to GitHub. */
export function invalidateMergeablePrCache(): void {
  cache = null;
}
