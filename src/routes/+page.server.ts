import { getHeroActivity } from '$lib/server/hero-activity';
import { HEALTH_TIMEZONE } from '$lib/health/day';
import { snapHeroTitle } from '$lib/landing/hero-titles-service';
import { getReleaseShowcase } from '$lib/releases/public';
import { isOwnerRequest } from '$lib/server/owner';
import type { PageServerLoad } from './$types';
import { getHeroBackgroundSettings, getHeroBackgroundAsset, heroBackgroundAsset } from '$lib/server/hero-background';
import { HERO_BACKGROUND_DEFAULTS } from '$lib/constants/hero-background';

export const load: PageServerLoad = async ({ fetch, locals, getClientAddress }) => {
  const activity = await getHeroActivity().catch(() => ({ steps: null, slot: 'default' as const }));
  const steps = activity.steps ?? 0;

  const dateStr = new Date()
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: HEALTH_TIMEZONE })
    .toUpperCase();

  // Streamed (un-awaited) — /api/vitals/state hits an external weather API
  // (Open-Meteo) on every render, so blocking first paint on it stalls the whole
  // hero. Instead let the shell + a deterministic fallback headline render
  // immediately; the live vitals and the snapped title stream in a beat later.
  // The `.catch` keeps the promise from rejecting so the {#await} needs no
  // {:catch} branch.
  const initialVitals = fetch('/api/vitals/state')
    .then((r) => r.json())
    .catch(() => null);

  // heroTitle is cheap to compute (cached DB read) but depends on live vitals,
  // so it rides the same stream as the vitals it's snapped from.
  const heroTitle = initialVitals.then((b) =>
    snapHeroTitle({
      hr: b?.pulse ?? 60,
      steps,
      temp: b?.weather?.temp ?? 15,
    }),
  );

  // Awaited, NOT streamed. The streaming above exists because /api/vitals/state
  // calls an external weather API on every render; this is a local Postgres read
  // behind a 5-minute memo. More to the point, SvelteKit serialises streamed
  // promises at the end of the body, so streamed data never lands in the SSR
  // HTML — and a section whose entire job is to make the work visible has to be
  // visible to crawlers and to visitors with JS off. It sits well below the
  // fold, so it is not an LCP candidate.
  const releases = await getReleaseShowcase(90);

  // The "More" index lists a few surfaces that are owner-only or belong to a
  // private project. Signed in they are useful shortcuts; signed out they were
  // dead ends (two 404s and two redirects to the login page), which is a poor
  // showing on the one page that has to work for strangers.
  const isOwner = await isOwnerRequest({ locals, getClientAddress }).catch(() => false);

  // Owner-only nudge that an account has stopped syncing.
  //
  // Awaited rather than streamed, for the same reason as `releases` above:
  // streamed promises are serialised at the end of the body, so a streamed
  // banner would pop in after hydration instead of being there on first paint.
  // The cost is bounded — a visitor never issues the query at all, and for the
  // owner it is four indexed local reads with no third-party round-trips (see
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

  const backgroundSettings = await getHeroBackgroundSettings().catch(() => ({ ...HERO_BACKGROUND_DEFAULTS, enabled: false }));
  const backgroundAsset = await getHeroBackgroundAsset(activity.slot).catch(() => heroBackgroundAsset);
  return { steps, dateStr, initialVitals, heroTitle, releases, isOwner, syncAttention, mergeablePrs,
    backgroundSettings, backgroundAsset };
};
