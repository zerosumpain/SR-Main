import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db
    .select({
      id: quickAnswers.id,
      topic: quickAnswers.topic,
      status: quickAnswers.status,
      createdAt: quickAnswers.createdAt,
      completedAt: quickAnswers.completedAt,
    })
    .from(quickAnswers)
    .orderBy(desc(quickAnswers.createdAt))
    .limit(100);
  return json(rows);
};
