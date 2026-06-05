import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { snapHeroTitle } from '$lib/landing/hero-titles-service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
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

  return { steps, dateStr, initialBiome, heroTitle };
};
