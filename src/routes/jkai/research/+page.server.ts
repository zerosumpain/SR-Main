import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { quickAnswers, researchSessions } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const [quick, deep] = await Promise.all([
    db
      .select({
        id: quickAnswers.id,
        topic: quickAnswers.topic,
        status: quickAnswers.status,
        durationMs: quickAnswers.durationMs,
        createdAt: quickAnswers.createdAt,
      })
      .from(quickAnswers)
      .orderBy(desc(quickAnswers.createdAt))
      .limit(15),
    db
      .select({
        id: researchSessions.id,
        topic: researchSessions.topic,
        status: researchSessions.status,
        createdAt: researchSessions.createdAt,
      })
      .from(researchSessions)
      .orderBy(desc(researchSessions.createdAt))
      .limit(15),
  ]);

  type Run = {
    id: string;
    topic: string;
    status: string;
    mode: 'quick' | 'deep';
    durationMs: number | null;
    createdAt: string;
    href: string;
  };

  const runs: Run[] = [
    ...quick.map((r) => ({
      id: r.id,
      topic: r.topic,
      status: r.status,
      mode: 'quick' as const,
      durationMs: r.durationMs ?? null,
      createdAt: r.createdAt.toISOString(),
      href: `/quickanswer/${r.id}`,
    })),
    ...deep.map((r) => ({
      id: r.id,
      topic: r.topic,
      status: r.status,
      mode: 'deep' as const,
      durationMs: null,
      createdAt: r.createdAt.toISOString(),
      href: `/deepdive/${r.id}`,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return { runs: runs.slice(0, 20) };
};
