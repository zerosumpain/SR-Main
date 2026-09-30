/**
 * GET /api/jkai/codegraph/node/:id — everything recorded against one file.
 *
 * Owner-gated by the ordinary `/api` rule, like the network endpoint. Loaded on
 * double-click rather than with the map: 1,400 nodes' worth of episodes,
 * lessons and neighbours is far more than any one view needs, and fetching it
 * up front would trade a fast map for a slow one nobody asked for.
 */
import { json, error } from '@sveltejs/kit';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphNodes } from '$lib/db/schema';
import { isOwnerRequest } from '$lib/server/owner';
import { memberEpisodeRow, memberLessonRow, memberMayReadRepo } from '$lib/member-view';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const { params } = event;
  const id = params.id;
  if (!id) throw error(400, 'missing id');

  const [node] = await db
    .select()
    .from(codegraphNodes)
    .where(and(eq(codegraphNodes.id, id), isNull(codegraphNodes.mergedIntoId)))
    .limit(1);
  if (!node) throw error(404, 'no such node');
  // jkai · codegraph, for a member: a public repository's files only, and never
  // a lesson's words — lessons are the owner's memory notes verbatim
  // (scripts/codegraph-backfill.mjs) — nor an episode's verification prose.
  const member = !(await isOwnerRequest(event));
  if (member && !memberMayReadRepo(node.repo)) throw error(404, 'no such node');

  const episodes = await db
    .execute(sql`
      SELECT e.id, e.title, e.fingerprint, e.gate, e.verdict, e.resolution, e.verification,
             e.pr_number, e.occurred_at, e.served_count, e.helpful_count, e.unhelpful_count
      FROM codegraph_episodes e
      JOIN codegraph_node_episodes ne ON ne.episode_id = e.id
      WHERE ne.node_id = ${id} AND e.retired_at IS NULL
      ORDER BY e.occurred_at DESC NULLS LAST
      LIMIT 40
    `)
    .then((r) => r.rows);

  const lessons = await db
    .execute(sql`
      SELECT l.id, l.title, l.body, l.origin, l.stale_at, l.observed_at,
             l.served_count, l.helpful_count, l.unhelpful_count
      FROM codegraph_lessons l
      JOIN codegraph_node_lessons nl ON nl.lesson_id = l.id
      WHERE nl.node_id = ${id} AND l.retired_at IS NULL
      ORDER BY l.observed_at DESC NULLS LAST
      LIMIT 40
    `)
    .then((r) => r.rows);

  // Both directions in one pass — an import edge is directional, but "what is
  // this connected to" is not a directional question.
  // GROUPED by (neighbour, kind), summing weight.
  //
  // Without the grouping a pair joined in both directions under one kind comes
  // back twice — which is duplicate noise in the list, and was worse than that
  // in the UI: the keyed `{#each}` threw `each_key_duplicate` and blanked the
  // whole panel. Deduping here rather than in the component keeps every caller
  // of this endpoint honest, not just the one that happened to crash.
  const neighbours = await db
    .execute(sql`
      SELECT n.canonical_path AS path, e.kind, sum(e.weight)::int AS weight
      FROM codegraph_edges e
      JOIN codegraph_nodes n
        ON n.id = CASE WHEN e.source_id = ${id} THEN e.target_id ELSE e.source_id END
      WHERE (e.source_id = ${id} OR e.target_id = ${id})
        AND e.suppressed = false
        AND n.merged_into_id IS NULL
      GROUP BY n.canonical_path, e.kind
      ORDER BY sum(e.weight) DESC, n.canonical_path
      LIMIT 60
    `)
    .then((r) => r.rows);

  return json({
    id: node.id,
    path: node.canonicalPath,
    kind: node.kind,
    existsOnHead: node.existsOnHead,
    episodeCount: node.episodeCount,
    lessonCount: node.lessonCount,
    episodes: member ? episodes.map((e) => memberEpisodeRow(e as Record<string, unknown>)) : episodes,
    lessons: member ? lessons.map((l, n) => memberLessonRow(l as Record<string, unknown>, n)) : lessons,
    neighbours,
  });
};
