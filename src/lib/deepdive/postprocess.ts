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
import { emitLog } from './worker';
import type { ResearchReport, IdentityCluster } from './types';

export async function runPostProcessing(
  sessionId: string,
  session: ResearchSession,
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

  // 3.5. Identity disambiguation
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

  // 4. Topic clustering
  emitLog(sessionId, '\u2139\uFE0F', 'Clustering topics...');

  if (allFacts.length > 0) {
    const factsForClustering = allFacts.slice(0, 200).map((f) => ({
      id: f.id,
      content: f.content,
    }));

    try {
      const clusterResult = await jsonCompletion<{
        clusters: { title: string; summary: string; fact_ids: string[] }[];
      }>(
        systemPrompt,
        `Group these facts into 4-8 coherent topic clusters aligned with the research goals. For each cluster return:\n- title: a short descriptive label\n- summary: 2-3 sentences that ONLY restate or synthesise the facts listed below. Do NOT add any information, claims, or context that isn't directly present in these facts.\n- fact_ids: list of fact IDs in this cluster\n\nFacts:\n${factsForClustering.map((f) => `[${f.id}] ${f.content}`).join('\n')}\n\nRespond with JSON: { "clusters": [...] }`,
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

  // 5. Executive summary
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
      `Write a 3-5 paragraph summary of the research findings. ONLY use information from the facts listed below — do not add anything else.\n\nFacts:\n${topFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nKey entities mentioned: ${topEntities.join(', ')}\n\nCounterfactuals found: ${counterfactuals.length}\n\nResearch goals: ${goals.join('; ')}`,
      { maxTokens: 2048 },
    );
  } catch (err) {
    console.error('[deepdive] Executive summary failed:', err);
    report.executive_summary = 'Executive summary generation failed.';
  }

  // 6. Chronological fact ordering
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

  // 7. Store report and complete
  await db
    .update(researchSessions)
    .set({ report })
    .where(eq(researchSessions.id, sessionId));

  emitLog(sessionId, '\u2139\uFE0F', 'Post-processing complete.');
}
