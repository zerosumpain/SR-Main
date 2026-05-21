import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import {
  generateHeroTitles,
  isGenerationInProgress,
} from '$lib/landing/hero-titles-service';
import { enumerateGrid } from '$lib/landing/hero-titles-buckets';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db
    .select()
    .from(heroTitles)
    .orderBy(heroTitles.hrBucket, heroTitles.stepsBucket, heroTitles.tempBucket);

  const generatedAt = rows.reduce<string | null>((latest, r) => {
    const t = r.generatedAt ? new Date(r.generatedAt).toISOString() : null;
    return t && (!latest || t > latest) ? t : latest;
  }, null);

  return {
    rows,
    count: rows.length,
    total: enumerateGrid().length,
    inProgress: isGenerationInProgress(),
    generatedAt,
  };
};

export const actions: Actions = {
  regenerate: async () => {
    if (isGenerationInProgress()) {
      return fail(409, { message: 'Generation already running' });
    }
    // Fire-and-forget — generation of ~150 entries takes minutes.
    void generateHeroTitles().catch((e) =>
      console.error('[hero-titles] admin regeneration failed', e),
    );
    return { started: true };
  },
};
