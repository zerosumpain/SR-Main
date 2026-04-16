import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const [row] = await db
    .select()
    .from(quickAnswers)
    .where(eq(quickAnswers.id, params.id));

  if (!row) throw error(404, 'Quick answer not found');

  return {
    answer: {
      ...row,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    },
  };
};
