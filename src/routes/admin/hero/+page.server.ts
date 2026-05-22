import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db
    .select()
    .from(heroTitles)
    .orderBy(
      heroTitles.hrBucket,
      heroTitles.stepsBucket,
      heroTitles.tempBucket,
      heroTitles.id,
    );

  const generatedAt = rows.reduce<string | null>((latest, r) => {
    const t = r.generatedAt ? new Date(r.generatedAt).toISOString() : null;
    return t && (!latest || t > latest) ? t : latest;
  }, null);

  return { rows, count: rows.length, generatedAt };
};
