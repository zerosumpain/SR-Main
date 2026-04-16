import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
  const answers = await db
    .select({
      id: quickAnswers.id,
      topic: quickAnswers.topic,
      status: quickAnswers.status,
      durationMs: quickAnswers.durationMs,
      createdAt: quickAnswers.createdAt,
    })
    .from(quickAnswers)
    .orderBy(desc(quickAnswers.createdAt))
    .limit(50);

  return {
    answers: answers.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
  };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const topic = (form.get('topic') as string)?.trim();
    const goalsRaw = form.get('goals') as string;

    if (!topic) {
      return { error: 'Please enter a topic' };
    }

    const goals = goalsRaw
      ? goalsRaw.split('\n').map((g) => g.trim()).filter(Boolean)
      : [];

    const [row] = await db
      .insert(quickAnswers)
      .values({ topic, goals })
      .returning({ id: quickAnswers.id });

    redirect(303, `/quickanswer/${row.id}`);
  },
};
