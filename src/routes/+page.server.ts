import { stepsToday } from '$lib/landing/steps-today.server';
import { HEALTH_TIMEZONE } from '$lib/constants/health-day';
import { getReleaseShowcase } from '$lib/releases/public';
import { loadCapabilityFacts } from '$lib/landing/capabilities.server';
import { getAllPosts } from '$lib/blog';
import { isOwnerRequest } from '$lib/server/owner';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, locals, getClientAddress }) => {
  // Today's steps in quarter-hours, midnight to 23:59, for the Steps channel.
  const steps = await stepsToday().catch(() => null);

  const dateStr = new Date()
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: HEALTH_TIMEZONE })
    .toUpperCase();

  // Streamed (un-awaited) — /api/vitals/state hits an external weather API
  // (Open-Meteo) on every render, so blocking first paint on it stalls the whole
  // hero. Instead let the shell render immediately with dashes; the live
  // vitals stream in a beat later. The `.catch` keeps the promise from
  // rejecting.
  const initialVitals = fetch('/api/vitals/state')
    .then((r) => r.json())
    .catch(() => null);

  // Awaited, NOT streamed. The streaming above exists because /api/vitals/state
  // calls an external weather API on every render; this is a local Postgres read
  // behind a 5-minute memo. More to the point, SvelteKit serialises streamed
  // promises at the end of the body, so streamed data never lands in the SSR
  // HTML, and the Ship and Releases channels draw from it on first paint.
  const releases = await getReleaseShowcase(90);

  // Cadences, the app's endpoint count and Daydream's hit rate: local reads,
  // memoised and timeboxed in the module, so they cost the front door nothing
  // noticeable and render server-side with everything else.
  const capabilities = await loadCapabilityFacts();

  // The two newest posts for the writing strip. Awaited so the links are in the
  // SSR HTML; a failure just drops the strip.
  const posts = await getAllPosts()
    .then((all) => all.slice(0, 2).map((p) => ({ slug: p.slug, title: p.title, publishedAt: p.publishedAt })))
    .catch(() => []);

  // Owner-only extras: the sync banner below and the footer's Admin link.
  const isOwner = await isOwnerRequest({ locals, getClientAddress }).catch(() => false);

  // Owner-only nudge that an account has stopped syncing.
  //
  // Awaited rather than streamed, for the same reason as `releases` above:
  // streamed promises are serialised at the end of the body, so a streamed
  // banner would pop in after hydration instead of being there on first paint.
  // The cost is bounded — a visitor never issues the query at all, and for the
  // owner it is five indexed local reads with no third-party round-trips (see
  // $lib/connectors/summary for why it reads stored state rather than probing).
  const syncAttention = isOwner
    ? await import('$lib/connectors/summary')
        .then((m) => m.syncAttentionSummary())
        .catch(() => null)
    : null;

  // Same banner, second signal: work finished and waiting on GitHub. Unlike the
  // sync summary this one cannot be answered locally, so $lib/github/open-prs
  // answers from cache and refreshes in the background. Only a cold cache waits,
  // and only for ~900ms; a broken one just means no line in the banner.
  const mergeablePrs = isOwner
    ? await import('$lib/github/open-prs')
        .then((m) => m.mergeablePrSummary())
        .catch(() => null)
    : null;

  return { steps, dateStr, initialVitals, releases, capabilities, posts, isOwner, syncAttention, mergeablePrs };
};
