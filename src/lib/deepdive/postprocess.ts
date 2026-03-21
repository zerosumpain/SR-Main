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
import type { ResearchReport } from './types';

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
        `Group these facts into 4-8 coherent topic clusters aligned with the research goals. For each cluster return:\n- title: a short descriptive label\n- summary: 2-3 sentence overview\n- fact_ids: list of fact IDs in this cluster\n\nFacts:\n${factsForClustering.map((f) => `[${f.id}] ${f.content}`).join('\n')}\n\nRespond with JSON: { "clusters": [...] }`,
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
      systemPrompt,
      `Write a 3-5 paragraph narrative summary of the research findings. Reference the most important facts and entities by name. Note any significant counterfactuals. Relate findings back to the original research goals.\n\nTop facts:\n${topFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nKey entities: ${topEntities.join(', ')}\n\nCounterfactuals found: ${counterfactuals.length}\n\nResearch goals: ${goals.join('; ')}`,
      { maxTokens: 2048 },
    );
  } catch (err) {
    console.error('[deepdive] Executive summary failed:', err);
    report.executive_summary = 'Executive summary generation failed.';
  }

  // 6. Store report and complete
  await db
    .update(researchSessions)
    .set({ report })
    .where(eq(researchSessions.id, sessionId));

  emitLog(sessionId, '\u2139\uFE0F', 'Post-processing complete.');
}
