import { db } from '$lib/db';
import { codegraphLessons, codegraphAssessments, codegraphSources } from '$lib/db/schema';
import { and, eq, isNull, desc } from 'drizzle-orm';
/** Read-only proposals: generated suggestions never become trusted memory automatically. */
export async function maintenanceQueue() {
  const lessons = await db.select().from(codegraphLessons).where(and(isNull(codegraphLessons.retiredAt), isNull(codegraphLessons.supersededById))).limit(1000);
  const assessments = await db.select().from(codegraphAssessments).orderBy(desc(codegraphAssessments.createdAt)).limit(200);
  const suggestions: Array<{ id: string; kind: string; reason: string; otherId?: string }> = [];
  const bodies = new Map<string, string>();
  for (const lesson of lessons) {
    const key = lesson.body.toLowerCase().replace(/\s+/g, ' ').trim();
    const earlier = bodies.get(key);
    if (earlier) suggestions.push({ id: lesson.id, kind: 'duplicate', otherId: earlier, reason: 'Identical normalised text. Review provenance before superseding either record.' });
    else bodies.set(key, lesson.id);
    if (lesson.staleAt) suggestions.push({ id: lesson.id, kind: 'revalidate', reason: 'Its cited implementation is no longer current.' });
  }
  for (const a of assessments.filter(a => ['stale', 'irrelevant', 'revalidate'].includes(a.verdict))) suggestions.push({ id: a.targetId, kind: a.verdict, reason: a.evidence });
  return { suggestions: suggestions.slice(0, 100), scanned: lessons.length, truncated: lessons.length === 1000 };
}
