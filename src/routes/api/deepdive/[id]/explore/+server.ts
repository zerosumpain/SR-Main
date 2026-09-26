import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, facts, entities } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { startResearch } from '$lib/deepdive/worker';
import { jsonCompletion } from '$lib/deepdive/ai';
import { DEFAULT_CONFIG } from '$lib/deepdive/types';
import type { SeedContext } from '$lib/deepdive/types';
import { depthPreset, type ResearchDepth } from '$lib/deepdive/depth';
import { requireResearchSession, reserveResearchStart } from '$lib/deepdive/session-access.server';

/**
 * The depth an explore child runs at. The insert never named one, so the row
 * took the column default ('investigation') and the worker ran that tier — the
 * owner's explores still do. A member's run at `brief`, the deepest tier their
 * access allows, with that tier's budget and config. Written explicitly so the
 * cap check and the row cannot drift apart.
 */
function exploreDepth(owner: boolean): ResearchDepth {
  return owner ? 'investigation' : 'brief';
}

export const POST: RequestHandler = async (event) => {
  const { params, request } = event;
  const { session: parentSession, access } = await requireResearchSession(event, params.id, 'read');
  const owner = access.level === 'owner';
  const depth = exploreDepth(owner);
  // Before any LLM goal-planning is spent on a run the caller may not start.
  await reserveResearchStart(access, depth);

  const body = await request.json();
  const { type, itemId, additionalContext } = body as {
    type: 'fact' | 'entity' | 'cluster' | 'gap' | 'hypothesis';
    itemId?: string;
    additionalContext?: string;
  };

  const parentGoals = (parentSession.goals ?? []) as string[];
  const parentReport = parentSession.report as any;

  let topic = '';
  let goals: string[] = [];
  const seedContext: SeedContext = {
    type,
    parentTopic: parentSession.topic,
    parentGoals,
  };

  switch (type) {
    case 'fact': {
      if (!itemId) return json({ error: 'itemId required for fact exploration' }, { status: 400 });
      const [fact] = await db
        .select()
        .from(facts)
        .where(and(eq(facts.id, itemId), eq(facts.sessionId, params.id)))
        .limit(1);
      if (!fact) return json({ error: 'Fact not found' }, { status: 404 });

      topic = `Deep dive: ${fact.content.slice(0, 100)}`;
      seedContext.factContents = [fact.content];

      // Generate goals from the fact
      try {
        const result = await jsonCompletion<{ goals: string[] }>(
          `You are a research planner. The parent research topic was: "${parentSession.topic}"`,
          `Generate 3-4 focused research goals for investigating this specific fact in more depth:\n\n"${fact.content}"\n\n${additionalContext ? `Additional context: ${additionalContext}` : ''}\n\nRespond with JSON: { "goals": [...] }`,
        );
        goals = result.goals ?? [];
      } catch {
        goals = [`Investigate: ${fact.content.slice(0, 100)}`];
      }
      break;
    }

    case 'entity': {
      if (!itemId) return json({ error: 'itemId required for entity exploration' }, { status: 400 });
      const [entity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, itemId), eq(entities.sessionId, params.id)))
        .limit(1);
      if (!entity) return json({ error: 'Entity not found' }, { status: 404 });

      topic = `Deep dive: ${entity.name}`;
      seedContext.entityNames = [entity.name];

      try {
        const result = await jsonCompletion<{ goals: string[] }>(
          `You are a research planner. The parent research topic was: "${parentSession.topic}"`,
          `Generate 3-4 focused research goals for investigating this entity in more depth:\n\nEntity: ${entity.name} (${entity.type})\nDescription: ${entity.description ?? 'N/A'}\n\n${additionalContext ? `Additional context: ${additionalContext}` : ''}\n\nRespond with JSON: { "goals": [...] }`,
        );
        goals = result.goals ?? [];
      } catch {
        goals = [`Research: ${entity.name}`];
      }
      break;
    }

    case 'cluster': {
      if (!itemId) return json({ error: 'itemId (cluster index) required' }, { status: 400 });
      const clusterIdx = parseInt(itemId, 10);
      const cluster = parentReport?.clusters?.[clusterIdx];
      if (!cluster) return json({ error: 'Cluster not found' }, { status: 404 });

      topic = `Deep dive: ${cluster.title}`;
      seedContext.clusterTitle = cluster.title;
      seedContext.clusterSummary = cluster.summary;

      // Get some facts from this cluster
      const clusterFactIds = (cluster.fact_ids ?? []).slice(0, 5);
      if (clusterFactIds.length > 0) {
        const clusterFacts = await Promise.all(
          clusterFactIds.map(async (fid: string) => {
            const [f] = await db
              .select({ content: facts.content })
              .from(facts)
              .where(and(eq(facts.id, fid), eq(facts.sessionId, params.id)))
              .limit(1);
            return f?.content;
          }),
        );
        seedContext.factContents = clusterFacts.filter(Boolean) as string[];
      }

      try {
        const result = await jsonCompletion<{ goals: string[] }>(
          `You are a research planner. The parent research topic was: "${parentSession.topic}"`,
          `Generate 3-4 focused research goals for investigating this topic cluster:\n\nCluster: ${cluster.title}\nSummary: ${cluster.summary}\n\n${additionalContext ? `Additional context: ${additionalContext}` : ''}\n\nRespond with JSON: { "goals": [...] }`,
        );
        goals = result.goals ?? [];
      } catch {
        goals = [`Investigate: ${cluster.title}`];
      }
      break;
    }

    case 'gap': {
      if (!itemId) return json({ error: 'itemId (gap index) required' }, { status: 400 });
      const gapIdx = parseInt(itemId, 10);
      const gap = parentReport?.knowledge_gaps?.[gapIdx];
      if (!gap) return json({ error: 'Gap not found' }, { status: 404 });

      topic = `Investigating gap: ${gap.gap.slice(0, 100)}`;
      seedContext.gapDescription = gap.gap;

      try {
        const result = await jsonCompletion<{ goals: string[] }>(
          `You are a research planner. The parent research topic was: "${parentSession.topic}"`,
          `Generate 3-4 focused research goals specifically designed to fill this knowledge gap:\n\nGap: ${gap.gap}\nType: ${gap.type}\nSeverity: ${gap.severity}\n\n${additionalContext ? `Additional context: ${additionalContext}` : ''}\n\nRespond with JSON: { "goals": [...] }`,
        );
        goals = result.goals ?? [];
      } catch {
        goals = [`Fill gap: ${gap.gap.slice(0, 100)}`];
      }
      break;
    }

    case 'hypothesis': {
      if (!itemId) return json({ error: 'itemId (hypothesis index) required' }, { status: 400 });
      const hypoIdx = parseInt(itemId, 10);
      const hypothesis = parentReport?.hypotheses?.[hypoIdx];
      if (!hypothesis) return json({ error: 'Hypothesis not found' }, { status: 404 });

      topic = `Testing hypothesis: ${hypothesis.hypothesis.slice(0, 100)}`;
      seedContext.hypothesisText = hypothesis.hypothesis;
      seedContext.suggestedQueries = hypothesis.suggested_queries;

      goals = [
        `Find evidence supporting: ${hypothesis.hypothesis}`,
        `Find evidence against: ${hypothesis.hypothesis}`,
        'Determine the current expert consensus on this claim',
      ];
      break;
    }

    default:
      return json({ error: 'Invalid exploration type' }, { status: 400 });
  }

  // Create child session
  const [childSession] = await db
    .insert(researchSessions)
    .values({
      topic,
      goals,
      parentSessionId: params.id,
      seedContext,
      ...(owner
        ? { config: { ...DEFAULT_CONFIG } }
        : { config: depthPreset(depth).config, budgetMs: depthPreset(depth).budgetMs }),
      depth,
      principalId: access.own,
    })
    .returning();

  // Start research
  startResearch(childSession.id);

  return json(childSession, { status: 201 });
};
