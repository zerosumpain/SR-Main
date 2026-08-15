import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { researchSessions, sources, entities, relationships, facts } from '$lib/db/schema';
import { eq, desc, and, count, inArray } from 'drizzle-orm';
import { redirect } from '@sveltejs/kit';
import { depthPreset, coerceDepth } from '$lib/deepdive/depth';
import { coerceScope, describeScope } from '$lib/deepdive/scope';
import { loadFrontier } from '$lib/deepdive/frontier';
import { rankSources, mediaMix } from '$lib/deepdive/media-type';
import { driveFileStem, existingStems, researchFolder } from '$lib/deepdive/to-drive';

export const load: PageServerLoad = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) throw redirect(302, '/research');

  /**
   * Sources, plus how many facts each one actually produced.
   *
   * The fact count is the whole point of the join. Ordering by credibility
   * alone put six government pages that yielded nothing above the two
   * trade-press articles that carried the entire report — see
   * `$lib/deepdive/media-type` for the ranking that replaces it.
   */
  const [srcRows, factsBySource] = await Promise.all([
    db
      .select({
        id: sources.id,
        url: sources.url,
        title: sources.title,
        snippet: sources.snippet,
        domain: sources.domain,
        credibilityScore: sources.credibilityScore,
        credibilityType: sources.credibilityType,
      })
      .from(sources)
      .where(eq(sources.sessionId, params.id))
      .orderBy(desc(sources.credibilityScore))
      .limit(80),
    db
      .select({ sourceId: facts.sourceId, n: count() })
      .from(facts)
      .where(eq(facts.sessionId, params.id))
      .groupBy(facts.sourceId),
  ]);

  const factCountBySource = new Map(factsBySource.map((r) => [r.sourceId, Number(r.n)]));
  const rankedSources = rankSources(
    srcRows.map((s) => ({ ...s, factCount: factCountBySource.get(s.id) ?? 0 })),
  );
  const mix = mediaMix(rankedSources);
  /** Per media kind, how many of its sources produced at least one fact. */
  const contributors: Record<string, number> = {};
  for (const s of rankedSources) {
    if (s.factCount > 0) contributors[s.media.kind] = (contributors[s.media.kind] ?? 0) + 1;
  }

  /**
   * Which of these sources already have a copy in /drive.
   *
   * Resolved here rather than by a fetch on mount so the rows render in their
   * true state — a "Keep in Drive" button that turns into "In Drive" a second
   * after the page settles reads as the page changing its mind.
   */
  const driveFolder = researchFolder(session.topic);
  const storedStems = await existingStems(driveFolder);
  const savedSourceIds = srcRows
    .filter((s) => storedStems.has(driveFileStem(driveFolder, s)))
    .map((s) => s.id);

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
   * The network itself is no longer built here. `SessionNetwork.svelte` fetches
   * `/api/research/<id>/network`, which runs the Intel graph's own PageRank and
   * community detection and returns the shape `NetworkGraph.svelte` consumes —
   * so the dashboard renders the same component the intel dashboard does
   * instead of a second, thinner force layout. Only the counts stay, for the
   * headline tiles.
   */
  const [entityTotal, relTotal] = await Promise.all([
    db.select({ n: count() }).from(entities).where(eq(entities.sessionId, params.id)),
    db.select({ n: count() }).from(relationships).where(eq(relationships.sessionId, params.id)),
  ]);

  /**
   * The timeline, with its facts resolved.
   *
   * `report.timeline` stores fact IDs; rendering it needed the contents, and
   * without them a period on the chart was a bar you could not open. This is
   * the only genuine series the report carries.
   */
  const rawTimeline = (
    (session.report as { timeline?: { date: string; facts?: string[] }[] } | null)?.timeline ?? []
  ).filter(
    (p) =>
      p &&
      typeof p.date === 'string' &&
      // `1970-01` is epoch zero wearing a date — what an undated fact becomes
      // when something upstream coerces null through a timestamp. Left in, one
      // bogus point at the far left compressed 2007–2025 into the right-hand
      // third of the axis. A genuine January 1970 datum is a price worth paying.
      !/^1970-01(-01)?$/.test(p.date.trim()),
  );
  const timelineFactIds = [...new Set(rawTimeline.flatMap((p) => p.facts ?? []))];
  const factContent = new Map<string, string>(
    timelineFactIds.length
      ? (
          await db
            .select({ id: facts.id, content: facts.content })
            .from(facts)
            .where(and(eq(facts.sessionId, params.id), inArray(facts.id, timelineFactIds)))
        ).map((f) => [f.id, f.content])
      : [],
  );
  const timeline = rawTimeline
    .map((p) => ({
      date: p.date,
      facts: (p.facts ?? [])
        .map((id) => ({ id, content: factContent.get(id) ?? '' }))
        // The synthesis occasionally cites a fact id that no longer resolves
        // (placeholders like `fact_1` appear in follow-ups). Dropping them beats
        // rendering an empty bullet.
        .filter((f) => f.content),
    }))
    .filter((p) => p.facts.length > 0);

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
      /** Set only while paused — the phase a Resume would pick up at. */
      resumeFrom: session.resumeFrom,
    },
    driveFolder,
    savedSourceIds,
    // The report has carried gaps, hypotheses, contradictions, clusters,
    // diversity and centrality on every completed investigation for months with
    // nothing rendering them.
    report: report ?? {},
    topEntities,
    timeline,
    counts: {
      sources: rankedSources.length,
      keySources: rankedSources.filter((s) => s.keyMaterial).length,
      entities: entityTotal[0]?.n ?? 0,
      relationships: relTotal[0]?.n ?? 0,
      facts: factTotal?.n ?? 0,
      counterfactuals: counterTotal?.n ?? 0,
      domains: new Set(rankedSources.map((s) => s.domain).filter(Boolean)).size,
    },
    tier: { label: preset.label, budgetMs: preset.budgetMs, extractsFacts: preset.extractsFacts },
    sources: rankedSources,
    mix,
    contributors,
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
