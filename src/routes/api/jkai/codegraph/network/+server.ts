/**
 * GET /api/jkai/codegraph/network — the graph, shaped for the Intel network
 * components.
 *
 * Owner-gated by the ordinary `/api` rule in hooks.server.ts: unlike
 * `/ingest` and `/query`, nothing service-to-service needs this, so it must NOT
 * be in the bypass list. A read that only the dashboard makes should need a
 * session.
 *
 * Fetched from the client, like intel's own network endpoint, because the
 * slicing controls re-query it and a page reload per control would be a much
 * worse surface.
 */
import { json } from '@sveltejs/kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphEdges, codegraphNodes } from '$lib/db/schema';
import {
  buildNetwork,
  worstVerdict,
  MAX_NODES,
  type EdgeRow,
  type GroupBy,
  type NodeRow,
} from '$lib/codegraph/network';
import type { RequestHandler } from './$types';

const GROUPS: GroupBy[] = ['directory', 'layer', 'gate', 'verdict', 'activity'];

function list(url: URL, key: string): string[] {
  const raw = url.searchParams.get(key);
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
}

export const GET: RequestHandler = async ({ url }) => {
  // No auth check here, deliberately: the `/api` catch-all in hooks.server.ts
  // already owner-gates everything not on its exact-match bypass list, and this
  // route is not on it (`gate:public-routes` proves the anonymous surface is
  // unchanged). Intel's own network endpoint does exactly this.
  //
  // A second, hand-rolled `locals.auth()` check here is not defence in depth —
  // it is a divergent idiom that reads as gated by a different rule, and it
  // also bypasses `AUTH_BYPASS=1`, so it breaks the graph on homeserv while
  // looking correct in review.
  const repo = url.searchParams.get('repo') || 'SR-Main';
  const groupByRaw = url.searchParams.get('groupBy') as GroupBy | null;
  const groupBy: GroupBy = groupByRaw && GROUPS.includes(groupByRaw) ? groupByRaw : 'directory';
  const livenessRaw = url.searchParams.get('liveness');
  const liveness =
    livenessRaw === 'live' || livenessRaw === 'deleted' ? livenessRaw : ('all' as const);

  // Per-file episode facts, folded in one pass so the adapter stays pure.
  // `worstVerdict` (not "latest") because a file that was verified and later
  // repaired is a file that needed repairing — that is the fact worth colouring.
  const facts = await db
    .execute(
      sql`
      SELECT n.id,
             array_remove(array_agg(DISTINCT e.gate), NULL)    AS gates,
             array_remove(array_agg(DISTINCT e.verdict), NULL) AS verdicts
      FROM codegraph_nodes n
      JOIN codegraph_node_episodes ne ON ne.node_id = n.id
      JOIN codegraph_episodes e ON e.id = ne.episode_id AND e.retired_at IS NULL
      WHERE n.repo = ${repo}
      GROUP BY n.id
    `,
    )
    .then((r) => r.rows as Array<{ id: string; gates: string[]; verdicts: string[] }>);

  const factById = new Map(facts.map((f) => [f.id, f]));

  // A file is stale when every lesson naming it is stale — one live lesson is
  // enough to keep it current.
  const staleRows = await db
    .execute(
      sql`
      SELECT n.id
      FROM codegraph_nodes n
      JOIN codegraph_node_lessons nl ON nl.node_id = n.id
      JOIN codegraph_lessons l ON l.id = nl.lesson_id AND l.retired_at IS NULL
      WHERE n.repo = ${repo}
      GROUP BY n.id
      HAVING count(*) FILTER (WHERE l.stale_at IS NULL) = 0
    `,
    )
    .then((r) => (r.rows as Array<{ id: string }>).map((x) => x.id));
  const stale = new Set(staleRows);

  const nodeRows = await db
    .select({
      id: codegraphNodes.id,
      canonicalPath: codegraphNodes.canonicalPath,
      kind: codegraphNodes.kind,
      displayName: codegraphNodes.displayName,
      summary: codegraphNodes.summary,
      episodeCount: codegraphNodes.episodeCount,
      lessonCount: codegraphNodes.lessonCount,
      existsOnHead: codegraphNodes.existsOnHead,
      lastSeenAt: codegraphNodes.lastSeenAt,
    })
    .from(codegraphNodes)
    .where(and(eq(codegraphNodes.repo, repo), isNull(codegraphNodes.mergedIntoId)));

  const nodes: NodeRow[] = nodeRows.map((n) => {
    const f = factById.get(n.id);
    return {
      ...n,
      gate: f?.gates?.length ? f.gates[0] : null,
      verdict: f ? worstVerdict(f.verdicts ?? []) : null,
      stale: stale.has(n.id),
    };
  });

  const edgeRows = await db
    .select({
      id: codegraphEdges.id,
      sourceId: codegraphEdges.sourceId,
      targetId: codegraphEdges.targetId,
      kind: codegraphEdges.kind,
      weight: codegraphEdges.weight,
      lastSeenAt: codegraphEdges.lastSeenAt,
    })
    .from(codegraphEdges)
    .where(eq(codegraphEdges.suppressed, false));

  const payload = buildNetwork({
    nodes,
    edges: edgeRows as EdgeRow[],
    filters: {
      groupBy,
      q: url.searchParams.get('q') ?? '',
      edgeKinds: list(url, 'edgeKinds'),
      gates: list(url, 'gates'),
      verdicts: list(url, 'verdicts'),
      liveness,
      onlyWithHistory: url.searchParams.get('onlyWithHistory') === '1',
      minHistory: Number(url.searchParams.get('minHistory') ?? 0) || 0,
      limit: Math.min(MAX_NODES, Number(url.searchParams.get('limit') ?? MAX_NODES) || MAX_NODES),
    },
  });

  return json(payload);
};
