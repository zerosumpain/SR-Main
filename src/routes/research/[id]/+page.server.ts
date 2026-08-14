import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions, sources, entities, relationships, facts } from '$lib/db/schema';
import { eq, desc, and, count } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { depthPreset, coerceDepth } from '$lib/deepdive/depth';
import { coerceScope, describeScope } from '$lib/deepdive/scope';
import { loadFrontier } from '$lib/deepdive/frontier';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw redirect(302, '/research');

  const srcs = await db
    .select({
      id: sources.id,
      url: sources.url,
      title: sources.title,
      domain: sources.domain,
      credibilityScore: sources.credibilityScore,
      credibilityType: sources.credibilityType,
    })
    .from(sources)
    .where(eq(sources.sessionId, params.id))
    .orderBy(desc(sources.credibilityScore))
    .limit(50);

  const leads = await loadFrontier(params.id);

  /**
   * `entity_centrality` is keyed by entity ID, not name — rendering it raw put
   * a row of UUIDs on screen. Resolve to names here rather than in the
   * component, which has no database.
   */
  const centrality = ((session.report as { entity_centrality?: Record<string, number> } | null)
    ?.entity_centrality ?? {}) as Record<string, number>;
  const centralIds = Object.entries(centrality)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const nameById = new Map(
    centralIds.length
      ? (
          await db
            .select({ id: entities.id, name: entities.name })
            .from(entities)
            .where(eq(entities.sessionId, params.id))
        ).map((e) => [e.id, e.name])
      : [],
  );
  /**
   * The entity network. Capped at the most-connected 60 nodes: a finished
   * session averages 253 entities and 151 relationships, and drawing all of
   * them produces a hairball that answers no question.
   */
  const [allEntities, allRels] = await Promise.all([
    db
      .select({ id: entities.id, name: entities.name, type: entities.type })
      .from(entities)
      .where(eq(entities.sessionId, params.id)),
    db
      .select({
        source: relationships.fromEntityId,
        target: relationships.toEntityId,
        kind: relationships.relationshipType,
        strength: relationships.strength,
      })
      .from(relationships)
      .where(eq(relationships.sessionId, params.id)),
  ]);

  const degree = new Map<string, number>();
  for (const r of allRels) {
    if (r.source) degree.set(r.source, (degree.get(r.source) ?? 0) + 1);
    if (r.target) degree.set(r.target, (degree.get(r.target) ?? 0) + 1);
  }
  const keep = new Set(
    allEntities
      .map((e) => ({ id: e.id, d: degree.get(e.id) ?? 0, c: centrality[e.id] ?? 0 }))
      .sort((a, b) => b.d - a.d || b.c - a.c)
      .slice(0, 60)
      .map((e) => e.id),
  );
  const graph = {
    nodes: allEntities
      .filter((e) => keep.has(e.id))
      .map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        degree: degree.get(e.id) ?? 0,
        weight: centrality[e.id] ?? 0,
      })),
    edges: allRels
      .filter((r) => r.source && r.target && keep.has(r.source) && keep.has(r.target))
      .map((r) => ({
        source: r.source as string,
        target: r.target as string,
        kind: r.kind,
        strength: r.strength ?? 0.5,
      })),
  };

  const [[factTotal], [counterTotal]] = await Promise.all([
    db
      .select({ n: count() })
      .from(facts)
      .where(and(eq(facts.sessionId, params.id), eq(facts.isCounterfactual, false))),
    db
      .select({ n: count() })
      .from(facts)
      .where(and(eq(facts.sessionId, params.id), eq(facts.isCounterfactual, true))),
  ]);

  const topEntities = centralIds
    .map(([id, score]) => ({ name: nameById.get(id) ?? null, score }))
    .filter((e): e is { name: string; score: number } => !!e.name);
  const depth = coerceDepth(session.depth);
  const preset = depthPreset(depth);
  const report = (session.report ?? null) as (Record<string, unknown> & { executive_summary?: string }) | null;

  return {
    session: {
      id: session.id,
      topic: session.topic,
      status: session.status,
      depth,
      goals: Array.isArray(session.goals) ? (session.goals as string[]) : [],
      summary: report?.executive_summary ?? '',
      durationMs: session.durationMs,
      errorMessage: session.errorMessage,
      createdAt: session.createdAt.toISOString(),
      scopeLabel: describeScope(coerceScope(session.scope)),
      shareToken: session.shareToken,
    },
    // The report has carried gaps, hypotheses, contradictions, clusters,
    // diversity and centrality on every completed investigation for months with
    // nothing rendering them.
    report: report ?? {},
    topEntities,
    graph,
    counts: {
      sources: srcs.length,
      entities: allEntities.length,
      relationships: allRels.length,
      facts: factTotal?.n ?? 0,
      counterfactuals: counterTotal?.n ?? 0,
    },
    tier: { label: preset.label, budgetMs: preset.budgetMs, extractsFacts: preset.extractsFacts },
    sources: srcs,
    leads: leads.map((l) => ({
      id: l.id,
      query: l.query,
      parentId: l.parentId,
      depth: l.depth,
      origin: l.origin,
      originDetail: l.originDetail,
      status: l.status,
      reason: l.reason,
      score: l.score,
    })),
  };
};
