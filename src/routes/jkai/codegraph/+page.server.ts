// The ER map's data.
//
// Nodes are files, edges are measured relations. Capped hard: past a few
// hundred nodes a force layout is a hairball that answers nothing, and the
// files worth seeing are the ones with history — so rank by episode+lesson
// count and draw the top slice rather than sampling at random.
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { codegraphEdges, codegraphNodes } from '$lib/db/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

const MAX_NODES = 160;

export const load: PageServerLoad = async () => {
  const nodes = await db
    .select({
      id: codegraphNodes.id,
      path: codegraphNodes.canonicalPath,
      kind: codegraphNodes.kind,
      episodes: codegraphNodes.episodeCount,
      lessons: codegraphNodes.lessonCount,
      existsOnHead: codegraphNodes.existsOnHead,
    })
    .from(codegraphNodes)
    .where(isNull(codegraphNodes.mergedIntoId))
    .orderBy(desc(sql`${codegraphNodes.episodeCount} + ${codegraphNodes.lessonCount}`), codegraphNodes.canonicalPath)
    .limit(MAX_NODES);

  const ids = nodes.map((n) => n.id);
  const edges = ids.length
    ? await db
        .select({
          source: codegraphEdges.sourceId,
          target: codegraphEdges.targetId,
          kind: codegraphEdges.kind,
          weight: codegraphEdges.weight,
        })
        .from(codegraphEdges)
        .where(and(
          eq(codegraphEdges.suppressed, false),
          inArray(codegraphEdges.sourceId, ids),
          inArray(codegraphEdges.targetId, ids),
        ))
        .orderBy(desc(codegraphEdges.weight))
        .limit(700)
    : [];

  // How much of the graph the drawing leaves out. Saying so is the difference
  // between "this is the graph" and "this is the busiest 160 files of it" —
  // a map that silently truncates reads as a map that is complete.
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(codegraphNodes)
    .where(isNull(codegraphNodes.mergedIntoId));

  return { nodes, edges, shown: nodes.length, total: Number(total ?? 0) };
};
