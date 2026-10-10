import { stepsToday } from '$lib/landing/steps-today.server';
import { ramblerDay } from '$lib/landing/ramblers/day.server';
import { HEALTH_TIMEZONE } from '$lib/constants/health-day';
import { getReleaseShowcase } from '$lib/releases/public';
import { loadCapabilityFacts } from '$lib/landing/capabilities.server';
import { loadShowcase } from '$lib/landing/showcase.server';
import { ownerSun } from '$lib/landing/sun.server';
import { sunOverride } from '$lib/landing/sun';
import { dev } from '$app/environment';
import { getAllPosts } from '$lib/blog';
import { isOwnerRequest } from '$lib/server/owner';
import { HERO_VIEW_COOKIE, chooseHeroView } from '$lib/landing/hero-view';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, locals, getClientAddress, cookies, url, setHeaders }) => {
  // Which way the hero reads: a ?view= link (never remembered), then the
  // visitor's own choice from the sr_hero_view cookie, then the notes.
  // Chosen here so the first paint already shows it.
  const heroView = chooseHeroView({ query: url.searchParams.get('view'), cookie: cookies.get(HERO_VIEW_COOKIE) });

  // This response differs by visitor (that cookie, the owner's banner and
  // Admin link below) and by the time of day. Nothing caches it today: the
  // origin sends no Cache-Control and Cloudflare's default leaves HTML alone.
  // Saying so keeps it that way should an edge or proxy rule ever start
  // caching pages: `private` keeps it out of every shared cache, `no-cache`
  // makes the browser ask again rather than replay yesterday's view, and
  // neither costs the back/forward cache the way `no-store` would.
  setHeaders({ 'cache-control': 'private, no-cache' });

  // The hero's dateline, "Fri 9 Oct", in the owner's day (set in capitals by CSS).
  const dateline = new Date()
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: HEALTH_TIMEZONE })
    .replace(',', '');

  // Streamed (un-awaited) — /api/vitals/state hits an external weather API
  // (Open-Meteo) on every render, so blocking first paint on it stalls the whole
  // hero. Instead let the shell render immediately with dashes; the live
  // vitals stream in a beat later. The `.catch` keeps the promise from
  // rejecting.
  const initialVitals = fetch('/api/vitals/state')
    .then((r) => r.json())
    .catch(() => null);

  // Coarse flags about today for the rambler (never totals, times or places).
  // Started once and shared: the showcase reads its sleep and recovery bands
  // from the same reading rather than asking the database twice.
  const dayReading = ramblerDay();

  // Everything below is awaited, NOT streamed, and independent, so it is read
  // in parallel: the slowest read sets first paint, not the sum of them.
  // Dev only: ?sun=<degrees>&rising=<0|1> pins the place view's sky so
  // screenshots hold still (null, and the address ignored, in production).
  const pinnedSun = sunOverride(url.searchParams, dev);

  const [steps, day, releases, capabilities, showcase, posts, sun] = await Promise.all([
    // Today's steps in quarter-hours, midnight to 23:59, for the steps footnote.
    stepsToday().catch(() => null),
    dayReading,
    // Awaited, NOT streamed. The streaming above exists because /api/vitals/state
    // calls an external weather API on every render; this is a local Postgres read
    // behind a 5-minute memo. More to the point, SvelteKit serialises streamed
    // promises at the end of the body, so streamed data never lands in the SSR
    // HTML, and the sentence's ship and release words draw from it on first paint.
    getReleaseShowcase(90),
    // Cadences, the app's endpoint count and Daydream's hit rate: local reads,
    // memoised and timeboxed in the module, so they cost the front door nothing
    // noticeable and render server-side with everything else.
    loadCapabilityFacts(),
    // The showcase below the hero: Daydream's week and impact, the health
    // record as totals and bands, and what the app is made of. Each part is
    // memoised and timeboxed in the module (a slow one renders as dashes, never
    // a slow page), and awaited so the figures are in the SSR HTML that the
    // count-ups start from.
    loadShowcase(new Date(), { day: dayReading }),
    // The two newest posts for the writing strip. Awaited so the links are in the
    // SSR HTML; a failure just drops the strip.
    getAllPosts()
      .then((all) => all.slice(0, 2).map((p) => ({ slug: p.slug, title: p.title, publishedAt: p.publishedAt })))
      .catch(() => []),
    // Where the sun stands for the owner just now, for the place view's sky:
    // an altitude in whole degrees and whether it is climbing, worked out on
    // the server from his position rounded to half a degree. Never the
    // position itself. Read from the location already known, never waiting;
    // only the place view, on a server that has never had a position, waits
    // for the first (up to 400ms). Null draws the default sky.
    pinnedSun ?? ownerSun(new Date(), { wait: heroView.view === 'place' }),
  ]);

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

  return {
    heroView,
    steps,
    day,
    dateline,
    initialVitals,
    releases,
    capabilities,
    showcase,
    posts,
    isOwner,
    syncAttention,
    mergeablePrs,
    sun,
    // True only when the dev override above set `sun`: it then wins over the live poll.
    sunPinned: pinnedSun != null,
  };
};
