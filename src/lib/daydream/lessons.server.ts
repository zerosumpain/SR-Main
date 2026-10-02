// src/lib/daydream/lessons.server.ts — the read behind `lessons.ts`.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { DEFAULT_SUBJECT } from './types';
import { dedupeLessons, LESSON_WINDOW_DAYS, LESSONS_IN_PROMPT, OWNER_REVIEWER, type Lesson } from './lessons';

export async function loadLessons(now = new Date(), limit = LESSONS_IN_PROMPT): Promise<Lesson[]> {
  const since = new Date(now.getTime() - LESSON_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({
      title: daydreamThoughts.title,
      narrative: daydreamThoughts.reviewNarrative,
      reasoning: daydreamThoughts.reviewReasoning,
      model: daydreamThoughts.reviewModel,
    })
    .from(daydreamThoughts)
    .where(
      and(
        eq(daydreamThoughts.subject, DEFAULT_SUBJECT),
        eq(daydreamThoughts.reviewVerdict, 'refuted'),
        gte(daydreamThoughts.reviewAt, since),
        sql`coalesce(${daydreamThoughts.reviewNarrative}, ${daydreamThoughts.reviewReasoning}) is not null`,
      ),
    )
    .orderBy(desc(daydreamThoughts.reviewAt))
    .limit(limit * 3);
  return dedupeLessons(
    rows.map((r) => ({
      title: r.title,
      lesson: r.narrative ?? r.reasoning ?? '',
      by: r.model === OWNER_REVIEWER ? 'owner' : 'check',
    })),
    limit,
  );
}
