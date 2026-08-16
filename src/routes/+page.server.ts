import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { snapHeroTitle } from '$lib/landing/hero-titles-service';
import { getReleaseShowcase } from '$lib/releases/public';
import { isOwnerRequest } from '$lib/server/owner';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, locals, getClientAddress }) => {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

  // Fast, awaited — a single indexed read. The hero strap and the title snap
  // both need today's step count, and it's cheap enough to block first paint.
  const stepsRows = await db
    .select({ value: appleHealthMetrics.value })
    .from(appleHealthMetrics)
    .where(
      and(
        eq(appleHealthMetrics.metricName, 'step_count'),
        gte(appleHealthMetrics.date, todayStart),
      ),
    )
    .catch(() => []);

  // Steps are stored * 100, sum all readings for today
  const steps = stepsRows.reduce((sum, r) => sum + Math.round((r.value || 0) / 100), 0);

  const dateStr = new Date()
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    .toUpperCase();

  // Streamed (un-awaited) — /api/biome/state hits an external weather API
  // (Open-Meteo) on every render, so blocking first paint on it stalls the whole
  // hero. Instead let the shell + a deterministic fallback headline render
  // immediately; the live vitals and the snapped title stream in a beat later.
  // The `.catch` keeps the promise from rejecting so the {#await} needs no
  // {:catch} branch.
  const initialBiome = fetch('/api/biome/state')
    .then((r) => r.json())
    .catch(() => null);

  // heroTitle is cheap to compute (cached DB read) but depends on live vitals,
  // so it rides the same stream as the biome it's snapped from.
  const heroTitle = initialBiome.then((b) =>
    snapHeroTitle({
      hr: b?.pulse ?? 60,
      steps,
      temp: b?.weather?.temp ?? 15,
    }),
  );

  // Awaited, NOT streamed. The streaming above exists because /api/biome/state
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
  // answers from cache and refreshes in the background — this read never waits
  // on GitHub, and a cold or broken cache just means no line in the banner.
  const mergeablePrs = isOwner
    ? await import('$lib/github/open-prs')
        .then((m) => m.mergeablePrSummary())
        .catch(() => null)
    : null;

  return { steps, dateStr, initialBiome, heroTitle, releases, isOwner, syncAttention, mergeablePrs };
};
