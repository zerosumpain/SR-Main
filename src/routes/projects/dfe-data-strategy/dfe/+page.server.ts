import type { PageServerLoad } from './$types';
import type { EstatePayload, ResolvedStat } from '../../dfe-data-estate/lib/types';
import {
  EES_PUBLICATIONS_STAT,
  LIVE_SOURCES,
  fetchPublications,
  publicationsFallback,
  toResolvedStat,
} from '../../dfe-data-estate/lib/live.server';

// Reuse The Data Estate's tested live-fetch module so the /dfe page shows the actual
// estate the strategy is built on, live. Timeout-wrapped + snapshot fallback per source.
// NB: do NOT set cache-control here — the project +layout.server.ts already does (a child
// load setting it again throws "header is already set").
const TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
let cache: { at: number; data: EstatePayload } | null = null;

function timed(f: typeof fetch): typeof fetch {
  return ((url: any, init: RequestInit = {}) =>
    f(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })) as typeof fetch;
}

const STAT_ORDER = ['ees-pubs', 'schools', 'vacancies', 'datasets', 'itt', 'govuk'];

async function build(f: typeof fetch): Promise<EstatePayload> {
  const fetchedAt = new Date().toISOString();
  const tf = timed(f);
  const resolved = await Promise.all(
    LIVE_SOURCES.map(async (s): Promise<ResolvedStat> => {
      try {
        const { value, detail } = await s.resolve(tf);
        if (!Number.isFinite(value)) throw new Error('non-finite');
        return toResolvedStat(s, value, detail, true);
      } catch {
        return toResolvedStat(s, s.snapshot, s.snapshotDetail, false);
      }
    }),
  );

  let publications: EstatePayload['publications'];
  let publicationsLive = false;
  let eesStat: ResolvedStat;
  try {
    const { count, publications: pubs } = await fetchPublications(tf);
    if (!Number.isFinite(count)) throw new Error('non-finite count');
    publications = pubs;
    publicationsLive = true;
    eesStat = toResolvedStat(EES_PUBLICATIONS_STAT, count, undefined, true);
  } catch {
    const fb = publicationsFallback();
    publications = fb.publications;
    eesStat = toResolvedStat(EES_PUBLICATIONS_STAT, fb.count, undefined, false);
  }

  const byId = new Map<string, ResolvedStat>(resolved.map((s) => [s.id, s]));
  byId.set(eesStat.id, eesStat);
  const stats = STAT_ORDER.map((id) => byId.get(id)).filter((s): s is ResolvedStat => Boolean(s));
  return { stats, publications, publicationsLive, fetchedAt };
}

export const load: PageServerLoad = async (event) => {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return { estate: cache.data };
  let estate: EstatePayload | null = null;
  try {
    estate = await build(event.fetch);
    cache = { at: now, data: estate };
  } catch {
    estate = cache?.data ?? null; // never break the page on a live-fetch failure
  }
  return { estate };
};
