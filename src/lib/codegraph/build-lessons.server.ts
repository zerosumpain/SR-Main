import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, like, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphLessons, codegraphNodeLessons, codegraphNodes, jkaiBuildDeliveries } from '$lib/db/schema';
import { BUILD_LESSON_PREFIX, BUILD_LESSON_WINDOW_DAYS, buildLessonRow, readBuildLesson, type AreaLesson, type BuildLessonInput } from './build-lessons';

/**
 * Write a build lesson straight into the graph and hang it off the nodes of
 * the files it cites. Insert-only on its id: a lesson is not edited in place.
 */
export async function recordBuildLesson(input: Omit<BuildLessonInput, 'key' | 'at'> & { key?: BuildLessonInput['key']; at?: Date }): Promise<string> {
  const row = buildLessonRow({ ...input, key: input.key ?? randomUUID(), at: input.at ?? new Date() });
  await db.transaction(async (tx) => {
    await tx.insert(codegraphLessons).values(row).onConflictDoNothing();
    if (!row.citedPaths.length) return;
    const nodes = await tx.select({ id: codegraphNodes.id }).from(codegraphNodes)
      .where(and(eq(codegraphNodes.repo, 'SR-Main'), inArray(codegraphNodes.canonicalPath, row.citedPaths)));
    if (nodes.length) await tx.insert(codegraphNodeLessons).values(nodes.map((n) => ({ nodeId: n.id, lessonId: row.id }))).onConflictDoNothing();
  });
  return row.id;
}

/**
 * The build lessons recorded for one product area in the last 90 days, read
 * from the graph. The area is the delivery's, joined through the lesson's
 * `originRef` (`/jkai/develop/<buildId>`), so a deleted build's lessons leave
 * the list with it while the graph keeps them, as the old copies did.
 * Tombstoned and superseded lessons are never listed; stale ones are listed
 * last and flagged.
 */
export async function areaLessons(area: string, limit = 8): Promise<AreaLesson[]> {
  const since = new Date(Date.now() - BUILD_LESSON_WINDOW_DAYS * 86_400_000);
  const rows = await db.select({ id: codegraphLessons.id, title: codegraphLessons.title, body: codegraphLessons.body,
    observedAt: codegraphLessons.observedAt, createdAt: codegraphLessons.createdAt, staleAt: codegraphLessons.staleAt })
    .from(codegraphLessons)
    .innerJoin(jkaiBuildDeliveries, eq(codegraphLessons.originRef, sql`'/jkai/develop/' || ${jkaiBuildDeliveries.buildId}`))
    .where(and(
      eq(codegraphLessons.origin, 'build'), like(codegraphLessons.id, `${BUILD_LESSON_PREFIX}%`),
      isNull(codegraphLessons.retiredAt), isNull(codegraphLessons.supersededById),
      gt(sql`coalesce(${codegraphLessons.observedAt}, ${codegraphLessons.createdAt})`, since),
      sql`${jkaiBuildDeliveries.state}->>'area' = ${area}`,
    ))
    .orderBy(sql`${codegraphLessons.staleAt} is not null`, desc(sql`coalesce(${codegraphLessons.observedAt}, ${codegraphLessons.createdAt})`), asc(codegraphLessons.id))
    .limit(limit);
  return rows.map(readBuildLesson);
}
