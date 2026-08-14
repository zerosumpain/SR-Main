import { db } from '$lib/db';
import {
  researchSessions,
  facts,
  entities,
  entityMentions,
  relationships,
  sources,
} from '$lib/db/schema';
import type { ResearchSession } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { chatCompletion, jsonCompletion } from './ai';
import { toVectorLiteral } from './vector';
import { emitLog } from './worker';
import { computeSourceAgreement } from './credibility';
import type { ResearchReport, IdentityCluster, KnowledgeGap, Hypothesis, Contradiction, FollowUpSuggestion, SourceDiversity } from './types';

export async function runPostProcessing(
  sessionId: string,
  session: ResearchSession,
  /**
   * Out-of-time check. Post-processing used to have NO time awareness at all —
   * it ran seven LLM steps unconditionally, which is how a session with a
   * seven-minute budget took 877 seconds. The steps below degrade in order of
   * least value first: the report keeps whatever was finished.
   */
  isTimeUp: () => boolean = () => false,
): Promise<void> {
  const goals = (session.goals ?? []) as string[];
  const systemPrompt = `You are a research summariser. Topic: "${session.topic}"\nGoals: ${goals.join('; ')}`;

  const report: ResearchReport = {
    ranked_facts: [],
    timeline: [],
    clusters: [],
    executive_summary: '',
    entity_centrality: {},
  };

  /**
   * Persist whatever has been computed and stop.
   *
   * Every step below is optional enrichment on top of a report that is already
   * useful, so running out of time must leave the finished parts intact rather
   * than discarding the lot.
   */
  const finalise = async (): Promise<void> => {
    await db.update(researchSessions).set({ report }).where(eq(researchSessions.id, sessionId));
    emitLog(sessionId, '\u2139\uFE0F', 'Post-processing stopped early — report saved with what was finished.');
  };

  // 1. Fact ranking
  emitLog(sessionId, '\u2139\uFE0F', 'Ranking facts...');

  const allFacts = await db
    .select()
    .from(facts)
    .where(and(eq(facts.sessionId, sessionId), eq(facts.isCounterfactual, false)));

  // Count sources per fact content (approximate via same source_id)
  const factScores = allFacts.map((f) => ({
    id: f.id,
    score: f.confidence,
    content: f.content,
  }));

  factScores.sort((a, b) => b.score - a.score);
  report.ranked_facts = factScores.map((f) => f.id);

  // 1b. Source agreement
  emitLog(sessionId, '\u2139\uFE0F', 'Computing source agreement...');
  try {
    await computeSourceAgreement(sessionId);
  } catch (err) {
    console.error('[deepdive] Source agreement computation failed:', err);
  }

  // 2. Entity centrality
  emitLog(sessionId, '\u2139\uFE0F', 'Computing entity centrality...');

  const allEntities = await db
    .select()
    .from(entities)
    .where(eq(entities.sessionId, sessionId));

  let maxCentrality = 0;
  const centralityScores: Record<string, number> = {};

  for (const entity of allEntities) {
    const mentionCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(entityMentions)
      .where(eq(entityMentions.entityId, entity.id));

    const relCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(relationships)
      .where(
        sql`${relationships.sessionId} = ${sessionId} AND (${relationships.fromEntityId} = ${entity.id} OR ${relationships.toEntityId} = ${entity.id})`,
      );

    const factCount = Number(mentionCount[0]?.count ?? 0);
    const relationshipCount = Number(relCount[0]?.count ?? 0);
    const raw = factCount * 0.6 + relationshipCount * 0.4;
    centralityScores[entity.id] = raw;
    if (raw > maxCentrality) maxCentrality = raw;
  }

  // Normalise to 0-1
  for (const id of Object.keys(centralityScores)) {
    centralityScores[id] = maxCentrality > 0 ? centralityScores[id] / maxCentrality : 0;
  }
  report.entity_centrality = centralityScores;

  // 3. Timeline construction
  emitLog(sessionId, '\u2139\uFE0F', 'Building timeline...');

  const datedFacts = allFacts.filter((f) => f.eventDate);
  datedFacts.sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime());

  const monthGroups = new Map<string, string[]>();
  for (const f of datedFacts) {
    const d = new Date(f.eventDate!);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!monthGroups.has(key)) monthGroups.set(key, []);
    monthGroups.get(key)!.push(f.id);
  }
  report.timeline = Array.from(monthGroups.entries()).map(([date, factIds]) => ({
    date,
    facts: factIds,
  }));

  /**
   * The executive summary — deliberately produced BEFORE anything skippable.
   *
   * It used to sit at step 5, behind identity disambiguation and clustering.
   * Once post-processing became budget-aware, a tight allowance skipped
   * everything from step 3.5 onward and the run finished with an EMPTY summary
   * — losing the single most valuable output while keeping the enrichment. It
   * depends only on the fact ranking and centrality computed above, so it can
   * run first and does.
   */
  // 4. Executive summary
  emitLog(sessionId, '\u2139\uFE0F', 'Writing executive summary...');

  const topFacts = factScores.slice(0, 20).map((f) => f.content);
  const topEntities = allEntities
    .sort((a, b) => (centralityScores[b.id] ?? 0) - (centralityScores[a.id] ?? 0))
    .slice(0, 10)
    .map((e) => `${e.name} (${e.type})`);

  // Count counterfactuals
  const counterfactuals = await db
    .select()
    .from(facts)
    .where(and(eq(facts.sessionId, sessionId), eq(facts.isCounterfactual, true)));

  try {
    report.executive_summary = await chatCompletion(
      systemPrompt + '\n\nCRITICAL: You must ONLY reference information that appears in the facts provided below. Do NOT add any claims, context, background knowledge, or speculation that is not directly stated in these facts. Every sentence in your summary must be traceable to one or more of the listed facts.',
      `Write a summary of the research findings in **markdown**: a short opening paragraph, then '##' sections with the substance, bold for the figures that matter, and bullets where a list genuinely reads better than prose. No title heading — the page supplies one. ONLY use information from the facts listed below — do not add anything else.\n\nFacts:\n${topFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nKey entities mentioned: ${topEntities.join(', ')}\n\nCounterfactuals found: ${counterfactuals.length}\n\nResearch goals: ${goals.join('; ')}`,
      { maxTokens: 2048 },
    );
  } catch (err) {
    console.error('[deepdive] Executive summary failed:', err);
    report.executive_summary = 'Executive summary generation failed.';
  }

  // 5. Identity disambiguation
  if (isTimeUp()) {
    emitLog(sessionId, '\u23F1\uFE0F', 'Out of time — skipping identity disambiguation and what follows.');
    await finalise();
    return;
  }
  emitLog(sessionId, '\u2139\uFE0F', 'Checking for identity disambiguation...');

  const personEntities = allEntities.filter((e) => e.type === 'person');
  if (personEntities.length > 0) {
    try {
      // Group facts by person entity
      const personFacts: { name: string; entityId: string; facts: string[] }[] = [];
      for (const pe of personEntities.slice(0, 20)) {
        const mentionRows = await db
          .select({ factId: entityMentions.factId })
          .from(entityMentions)
          .where(eq(entityMentions.entityId, pe.id));
        const factContents = mentionRows
          .map((m) => allFacts.find((f) => f.id === m.factId)?.content)
          .filter(Boolean) as string[];
        if (factContents.length > 0) {
          personFacts.push({ name: pe.name, entityId: pe.id, facts: factContents });
        }
      }

      if (personFacts.length > 0) {
        const disambigResult = await jsonCompletion<{
          clusters: { name: string; identifier: string; fact_indices: number[] }[];
        }>(
          systemPrompt,
          `Given the following person entities and their associated facts, identify if any person name refers to MULTIPLE distinct real-world individuals. Only report cases where you are confident there are genuinely different people sharing the same name.\n\nFor each distinct identity found, return:\n- name: the person's name\n- identifier: a short distinguishing description (e.g. "CEO of X" vs "footballer")\n- fact_indices: which fact numbers belong to this identity\n\nIf all facts about a name refer to the same person, do NOT include that name.\n\nPeople and their facts:\n${personFacts.map((pf, i) => `\n[${pf.name}]\n${pf.facts.map((f, j) => `  ${j + 1}. ${f}`).join('\n')}`).join('\n')}\n\nRespond with JSON: { "clusters": [...] }. Return empty array if no disambiguation needed.`,
          { maxTokens: 4096 },
        );

        if (disambigResult.clusters?.length > 0) {
          report.identity_clusters = disambigResult.clusters.map((c) => ({
            name: c.name,
            identifier: c.identifier,
            fact_ids: [], // We store the cluster info; fact_ids could be populated if needed
          }));
          emitLog(sessionId, '\u2139\uFE0F', `Found ${disambigResult.clusters.length} disambiguated identities`);
        }
      }
    } catch (err) {
      console.error('[deepdive] Identity disambiguation failed:', err);
    }
  }

  // 6. Topic clustering
  if (isTimeUp()) {
    emitLog(sessionId, '\u23F1\uFE0F', 'Out of time — skipping topic clustering and what follows.');
    await finalise();
    return;
  }
  emitLog(sessionId, '\u2139\uFE0F', 'Clustering topics...');

  if (allFacts.length > 0) {
    const factsForClustering = allFacts.slice(0, 200).map((f) => ({
      id: f.id,
      content: f.content,
    }));

    // Get source categories to use as clustering hints
    const allSources = await db
      .select({ id: sources.id, category: sources.category })
      .from(sources)
      .where(eq(sources.sessionId, sessionId));
    const sourceCategories = [...new Set(allSources.map((s) => s.category).filter(Boolean))];
    const categoryHint = sourceCategories.length > 0
      ? `\n\nSource categories discovered during research (use as hints for cluster themes, but don't be limited by them): ${sourceCategories.join(', ')}`
      : '';

    try {
      const clusterResult = await jsonCompletion<{
        clusters: { title: string; summary: string; fact_ids: string[] }[];
      }>(
        systemPrompt,
        `Group these facts into 4-8 coherent topic clusters aligned with the research goals. For each cluster return:\n- title: a short descriptive label\n- summary: 2-3 sentences that ONLY restate or synthesise the facts listed below. Do NOT add any information, claims, or context that isn't directly present in these facts.\n- fact_ids: list of fact IDs in this cluster${categoryHint}\n\nFacts:\n${factsForClustering.map((f) => `[${f.id}] ${f.content}`).join('\n')}\n\nRespond with JSON: { "clusters": [...] }`,
        { maxTokens: 8192 },
      );

      report.clusters = clusterResult.clusters ?? [];
    } catch (err) {
      console.error('[deepdive] Clustering failed:', err);
      report.clusters = [
        {
          title: 'All Findings',
          summary: 'All research findings grouped together.',
          fact_ids: allFacts.map((f) => f.id),
        },
      ];
    }
  }

  // 7. Chronological fact ordering
  if (isTimeUp()) {
    emitLog(sessionId, '\u23F1\uFE0F', 'Out of time — skipping chronological ordering and what follows.');
    await finalise();
    return;
  }
  emitLog(sessionId, '\u2139\uFE0F', 'Ordering facts chronologically...');

  const topFactsForOrdering = factScores.slice(0, 20);
  if (topFactsForOrdering.length > 0) {
    try {
      const chronoResult = await jsonCompletion<{ ordered_fact_ids: string[] }>(
        systemPrompt,
        `Order these facts chronologically, from earliest to most recent. For facts without explicit dates, infer the likely chronological position from context (e.g. birth/origin before career, early career before later career).\n\nFacts:\n${topFactsForOrdering.map((f) => `[${f.id}] ${f.content}`).join('\n')}\n\nRespond with JSON: { "ordered_fact_ids": ["id1", "id2", ...] }`,
        { maxTokens: 2048 },
      );

      if (chronoResult.ordered_fact_ids?.length > 0) {
        report.chronological_fact_ids = chronoResult.ordered_fact_ids;
      }
    } catch (err) {
      console.error('[deepdive] Chronological ordering failed:', err);
    }
  }

  // 8. Knowledge Gap Analysis
  if (isTimeUp()) {
    emitLog(sessionId, '\u23F1\uFE0F', 'Out of time — skipping knowledge gap analysis and what follows.');
    await finalise();
    return;
  }
  emitLog(sessionId, '\u2139\uFE0F', 'Analysing knowledge gaps...');

  try {
    const clusterSummaries = report.clusters.map((c) => `${c.title}: ${c.summary}`).join('\n');
    const topEntityNames = allEntities
      .sort((a, b) => (centralityScores[b.id] ?? 0) - (centralityScores[a.id] ?? 0))
      .slice(0, 15)
      .map((e) => e.name);

    const gapResult = await jsonCompletion<{ gaps: KnowledgeGap[] }>(
      systemPrompt,
      `Analyse these research findings for knowledge gaps and blind spots.

Research goals: ${goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}

Topic clusters found:
${clusterSummaries}

Key entities: ${topEntityNames.join(', ')}
Total facts: ${allFacts.length}, Counterfactuals: ${counterfactuals.length}

Identify what the research DID NOT adequately cover:
- Goals that remain unanswered or only partially answered (type: unanswered_goal, include goal_index)
- Geographic regions mentioned but not explored (type: geographic)
- Time periods with significant gaps (type: temporal)
- Stakeholders or perspectives missing (type: stakeholder)
- Methodological limitations (type: methodological)

For each gap, rate severity: high (critical to research goals), medium (would improve understanding), low (nice to have).

Respond with JSON: { "gaps": [{ "gap": "...", "type": "...", "severity": "...", "goal_index": null }] }`,
      { maxTokens: 4096 },
    );

    report.knowledge_gaps = gapResult.gaps ?? [];
    emitLog(sessionId, '\u2139\uFE0F', `Found ${report.knowledge_gaps.length} knowledge gaps`);
  } catch (err) {
    console.error('[deepdive] Knowledge gap analysis failed:', err);
  }

  // 8. Hypothesis Generation
  emitLog(sessionId, '\u2139\uFE0F', 'Generating hypotheses...');

  try {
    const topFactsForHypotheses = factScores.slice(0, 30).map((f) => `[${f.id}] ${f.content}`).join('\n');
    const clusterSummaries = report.clusters.map((c) => `${c.title}: ${c.summary}`).join('\n');

    const hypoResult = await jsonCompletion<{
      hypotheses: Hypothesis[];
      contradictions: Contradiction[];
    }>(
      systemPrompt,
      `Based on these research findings, generate 3-5 testable hypotheses and identify internal contradictions.

Top facts:
${topFactsForHypotheses}

Topic clusters:
${clusterSummaries}

For each hypothesis:
- hypothesis: a clear, testable claim synthesised from the evidence
- supporting_fact_ids: fact IDs that support it
- tension_fact_ids: fact IDs that create tension with it
- testability: high (easily verifiable), medium (requires effort), low (hard to test)
- suggested_queries: 2-3 search queries that would help test this hypothesis

Also identify contradictions — pairs of facts that are in tension with each other:
- fact_a_id, fact_b_id: the two facts
- tension: a sentence explaining the contradiction

Respond with JSON: { "hypotheses": [...], "contradictions": [...] }`,
      { maxTokens: 8192 },
    );

    report.hypotheses = hypoResult.hypotheses ?? [];
    report.contradictions_map = hypoResult.contradictions ?? [];
    emitLog(sessionId, '\u2139\uFE0F', `Generated ${report.hypotheses.length} hypotheses, ${report.contradictions_map.length} contradictions`);
  } catch (err) {
    console.error('[deepdive] Hypothesis generation failed:', err);
  }

  // 9. Follow-up Suggestions
  emitLog(sessionId, '\u2139\uFE0F', 'Generating follow-up suggestions...');

  try {
    const gapsSummary = (report.knowledge_gaps ?? []).map((g) => g.gap).join('; ');
    const clusterTitles = report.clusters.map((c) => c.title).join(', ');

    const followupResult = await jsonCompletion<{ followups: FollowUpSuggestion[] }>(
      systemPrompt,
      `Based on the research findings, suggest 3-5 follow-up investigations that would be most valuable.

Executive summary: ${report.executive_summary.slice(0, 500)}
Knowledge gaps: ${gapsSummary || 'None identified'}
Topic clusters: ${clusterTitles}
Research goals: ${goals.join('; ')}

For each follow-up:
- question: a focused research question
- context: 1-2 sentences explaining why this is worth investigating
- seed_fact_ids: up to 3 fact IDs from the current research that motivate this follow-up

Respond with JSON: { "followups": [...] }`,
      { maxTokens: 4096 },
    );

    report.suggested_followups = followupResult.followups ?? [];
    emitLog(sessionId, '\u2139\uFE0F', `Generated ${report.suggested_followups.length} follow-up suggestions`);
  } catch (err) {
    console.error('[deepdive] Follow-up suggestions failed:', err);
  }

  // 10. Source Diversity Metrics
  emitLog(sessionId, '\u2139\uFE0F', 'Computing source diversity...');

  try {
    const allSourcesForDiversity = await db
      .select({ domain: sources.domain, credibilityType: sources.credibilityType })
      .from(sources)
      .where(eq(sources.sessionId, sessionId));

    const domains = new Set(allSourcesForDiversity.map((s) => s.domain).filter(Boolean));
    const byType: Record<string, number> = {};
    for (const s of allSourcesForDiversity) {
      const t = s.credibilityType || 'other';
      byType[t] = (byType[t] ?? 0) + 1;
    }

    // Herfindahl concentration index (lower = more diverse, 0-1 scale)
    const total = allSourcesForDiversity.length;
    let hhi = 0;
    if (total > 0) {
      for (const count of Object.values(byType)) {
        hhi += (count / total) ** 2;
      }
    }

    report.source_diversity = {
      total_domains: domains.size,
      by_type: byType,
      concentration_index: Math.round(hhi * 100) / 100,
    };
  } catch (err) {
    console.error('[deepdive] Source diversity metrics failed:', err);
  }

  // 11. Novelty scoring
  emitLog(sessionId, '\u2139\uFE0F', 'Computing novelty scores...');

  try {
    const factsWithEmbeddings = allFacts.filter((f) => f.embedding);
    if (factsWithEmbeddings.length > 1) {
      for (const fact of factsWithEmbeddings) {
        if (!fact.embedding) continue;
        const vectorStr = toVectorLiteral(fact.embedding);

        // Average cosine distance to all other facts
        const distResult = await db.execute(
          sql`SELECT AVG(f.embedding <=> ${vectorStr}::vector) as avg_dist
              FROM fact f
              WHERE f.session_id = ${sessionId}
                AND f.id != ${fact.id}
                AND NOT f.is_counterfactual
                AND f.embedding IS NOT NULL`,
        );

        const avgDist = Number((distResult.rows[0] as any)?.avg_dist ?? 0);
        // Novelty = high distance + low confidence = surprising outlier
        const novelty = avgDist * 0.6 + (1 - fact.confidence) * 0.4;

        await db.update(facts).set({ noveltyScore: Math.round(novelty * 1000) / 1000 }).where(eq(facts.id, fact.id));
      }
    }
  } catch (err) {
    console.error('[deepdive] Novelty scoring failed:', err);
  }

  // 12. Store report and complete
  await db
    .update(researchSessions)
    .set({ report })
    .where(eq(researchSessions.id, sessionId));

  emitLog(sessionId, '\u2139\uFE0F', 'Post-processing complete.');
}
