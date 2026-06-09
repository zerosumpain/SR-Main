import type { PageServerLoad } from './$types';
import { requireProjectPublic } from '$lib/projects/guard';
import type { EstatePayload, ResolvedStat } from './lib/types';
import {
  EES_PUBLICATIONS_STAT,
  LIVE_SOURCES,
  fetchPublications,
  publicationsFallback,
  toResolvedStat
} from './lib/live.server';

const TTL_MS = 30 * 60 * 1000; // serve a cached payload for 30 minutes
const FETCH_TIMEOUT_MS = 5000;

let cache: { at: number; data: EstatePayload } | null = null;

// Wrap SvelteKit's fetch so every live call self-aborts — a hung upstream can't stall the page.
function timed(f: typeof fetch): typeof fetch {
  return ((url: any, init: RequestInit = {}) =>
    f(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })) as typeof fetch;
}

// Desired left-to-right order of the signal cards.
const STAT_ORDER = ['vacancies', 'itt', 'schools', 'ees-pubs', 'datasets', 'govuk'];

async function build(f: typeof fetch): Promise<EstatePayload> {
  const fetchedAt = new Date().toISOString();
  const tf = timed(f);

  // Each source resolves independently; on any failure we fall back to its snapshot.
  const resolved = await Promise.all(
    LIVE_SOURCES.map(async (s): Promise<ResolvedStat> => {
      try {
        const { value, detail } = await s.resolve(tf);
        if (!Number.isFinite(value)) throw new Error('non-finite value');
        return toResolvedStat(s, value, detail, true);
      } catch {
        return toResolvedStat(s, s.snapshot, s.snapshotDetail, false);
      }
    })
  );

  // EES publications: one call powers both the count stat and the live feed.
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
  const { authedPrivate, viaShare } = await requireProjectPublic('dfe-data-estate', event);
  // Never let a shared cache hold an authed preview OR a shared private view.
  const noStore = authedPrivate || viaShare;
  event.setHeaders({
    'cache-control': noStore ? 'private, no-store' : 'public, max-age=0, s-maxage=1800',
    ...(noStore ? { 'x-robots-tag': 'noindex' } : {}),
  });

  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return { estate: cache.data };
  }
  const data = await build(event.fetch);
  cache = { at: now, data };
  return { estate: data };
};
