import { db } from '$lib/db';
import { sources, facts, entities, entityMentions, relationships } from '$lib/db/schema';
import type { ResearchSession, Source } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { jsonCompletion, generateEmbedding } from './ai';
import { extract } from './tavily';
import { emitLog, emitStats, shouldStop } from './worker';
import type { SessionConfig, SessionStats } from './types';

async function isDuplicate(sessionId: string, content: string): Promise<boolean> {
  try {
    const embedding = await generateEmbedding(content);
    const vectorStr = `[${embedding.join(',')}]`;

    // Query for similar facts using cosine distance
    const result = await db.execute(
      sql`SELECT id FROM fact
          WHERE session_id = ${sessionId}
            AND embedding IS NOT NULL
            AND embedding <=> ${vectorStr}::vector < 0.08
          LIMIT 1`,
    );

    if (result.rows.length > 0) return true;

    // Store embedding for future comparisons
    return false;
  } catch (err) {
    console.error('[deepdive] Embedding dedup failed, skipping:', err);
    return false;
  }
}

async function getEmbeddingForInsert(content: string): Promise<number[] | null> {
  try {
    return await generateEmbedding(content);
  } catch {
    return null;
  }
}

export async function runPhase2(
  sessionId: string,
  session: ResearchSession,
  isTimeUp: () => boolean,
): Promise<void> {
  const config = (session.config ?? {}) as SessionConfig;
  const depth = config.analysisDepth ?? 'standard';
  const goals = (session.goals ?? []) as string[];

  const systemPrompt = `You are a research analyst. Topic: "${session.topic}"\nGoals: ${goals.join('; ')}`;

  // Get all phase 1 sources
  const allSources = await db
    .select()
    .from(sources)
    .where(and(eq(sources.sessionId, sessionId), eq(sources.phase, 1)));

  const stats: SessionStats = {
    sourcesFound: allSources.length,
    factsExtracted: 0,
    entitiesIdentified: 0,
    counterfactualsRaised: 0,
  };

  let totalNewFacts = 0;
  let recentNewFacts = 0;
  let sourcesProcessed = 0;

  // Process in batches of 5
  for (let i = 0; i < allSources.length; i += 5) {
    if (isTimeUp()) break;

    const batch = allSources.slice(i, i + 5);
    const batchPromises = batch.map((source) => processSource(source));

    const results = await Promise.allSettled(batchPromises);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        totalNewFacts += result.value;
        recentNewFacts += result.value;
      }
    }

    sourcesProcessed += batch.length;
    emitStats(sessionId, stats);

    // Novelty check every 20 sources
    if (sourcesProcessed % 20 === 0 && sourcesProcessed > 0) {
      if (recentNewFacts < 5) {
        emitLog(sessionId, '\u2139\uFE0F', `Low novelty (${recentNewFacts} new facts in last 20 sources). Ending Phase 2.`);
        break;
      }
      recentNewFacts = 0;
    }
  }

  emitLog(sessionId, '\u2139\uFE0F', `Phase 2 complete: ${stats.factsExtracted} facts, ${stats.entitiesIdentified} entities`);

  async function processSource(source: Source): Promise<number> {
    if (isTimeUp()) return 0;

    emitLog(sessionId, '\u{1F50D}', `Analysing: ${source.title?.slice(0, 50) ?? source.url}`);

    // Try to fetch full content
    let content = source.snippet ?? '';
    try {
      const extracted = await extract([source.url]);
      if (extracted.results?.[0]?.raw_content) {
        content = extracted.results[0].raw_content.slice(0, 10000);
      }
    } catch {
      // Fall back to snippet
    }

    if (!content) return 0;

    // Pass 1: Extract facts
    let newFacts = 0;
    try {
      const factResult = await jsonCompletion<{
        facts: {
          content: string;
          event_date: string | null;
          confidence: number;
          tags: string[];
        }[];
      }>(
        systemPrompt,
        `Extract all factual claims from this source content. For each fact return:\n- content: the factual claim as a single clear sentence\n- event_date: best estimate of when this fact became true (ISO date string or null)\n- confidence: 0.0-1.0 based on how clearly the source supports it\n- tags: 2-4 short topic tags\n\nSource: ${source.title}\nContent:\n${content.slice(0, 6000)}\n\nRespond with JSON: { "facts": [...] }`,
        { maxTokens: 8192 },
      );

      for (const f of factResult.facts ?? []) {
        if (!f.content || f.content.length < 10) continue;

        // Dedup check
        const dupe = await isDuplicate(sessionId, f.content);
        if (dupe) continue;

        const embedding = await getEmbeddingForInsert(f.content);

        await db.insert(facts).values({
          sessionId,
          sourceId: source.id,
          content: f.content,
          eventDate: f.event_date ? new Date(f.event_date) : null,
          confidence: Math.max(0, Math.min(1, f.confidence ?? 0.5)),
          tags: f.tags ?? [],
          embedding,
        });

        newFacts++;
        stats.factsExtracted++;
      }

      emitLog(sessionId, '\u2705', `${newFacts} facts from: ${source.title?.slice(0, 40) ?? 'source'}`);
    } catch (err) {
      console.error('[deepdive] Fact extraction failed:', err);
    }

    // Pass 2: NER (Standard + Deep)
    if (depth !== 'shallow') {
      try {
        const nerResult = await jsonCompletion<{
          entities: { name: string; type: string; description: string }[];
        }>(
          systemPrompt,
          `Perform Named Entity Recognition on this content. For each entity found, return:\n- name: the entity name\n- type: one of person, organisation, location, event, concept, product, other\n- description: a one-sentence description\n\nContent:\n${content.slice(0, 6000)}\n\nRespond with JSON: { "entities": [...] }`,
        );

        for (const e of nerResult.entities ?? []) {
          if (!e.name) continue;

          const normalised = e.name.toLowerCase().trim();

          // Check if entity already exists for this session
          const existing = await db
            .select()
            .from(entities)
            .where(
              and(
                eq(entities.sessionId, sessionId),
                sql`lower(trim(${entities.name})) = ${normalised}`,
              ),
            )
            .limit(1);

          let entityId: string;
          if (existing.length > 0) {
            entityId = existing[0].id;
          } else {
            const [created] = await db
              .insert(entities)
              .values({
                sessionId,
                name: e.name,
                type: e.type || 'other',
                description: e.description,
              })
              .returning();
            entityId = created.id;
            stats.entitiesIdentified++;
          }

          // Link entity to facts from this source
          const sourceFacts = await db
            .select()
            .from(facts)
            .where(and(eq(facts.sessionId, sessionId), eq(facts.sourceId, source.id)));

          for (const fact of sourceFacts) {
            if (fact.content.toLowerCase().includes(normalised)) {
              await db.insert(entityMentions).values({
                entityId,
                factId: fact.id,
                context: fact.content.slice(0, 200),
              });
            }
          }
        }

        emitLog(sessionId, '\u{1F9E9}', `Entities identified from: ${source.title?.slice(0, 40) ?? 'source'}`);
      } catch (err) {
        console.error('[deepdive] NER failed:', err);
      }
    }

    // Pass 3: Relationship extraction (Deep only)
    if (depth === 'deep') {
      try {
        const relResult = await jsonCompletion<{
          relationships: {
            from_entity: string;
            to_entity: string;
            relationship_type: string;
            sentiment: string;
            strength: number;
          }[];
        }>(
          systemPrompt,
          `Identify relationships between entities in this content. For each relationship return:\n- from_entity: name of the first entity\n- to_entity: name of the second entity\n- relationship_type: e.g. "employs", "caused", "part_of", "founded", "opposed_to"\n- sentiment: positive, negative, neutral, or contested\n- strength: 0.0-1.0\n\nContent:\n${content.slice(0, 6000)}\n\nRespond with JSON: { "relationships": [...] }`,
        );

        for (const rel of relResult.relationships ?? []) {
          if (!rel.from_entity || !rel.to_entity) continue;

          // Look up entity IDs
          const fromNorm = rel.from_entity.toLowerCase().trim();
          const toNorm = rel.to_entity.toLowerCase().trim();

          const [fromEntity] = await db
            .select()
            .from(entities)
            .where(
              and(
                eq(entities.sessionId, sessionId),
                sql`lower(trim(${entities.name})) = ${fromNorm}`,
              ),
            )
            .limit(1);

          const [toEntity] = await db
            .select()
            .from(entities)
            .where(
              and(
                eq(entities.sessionId, sessionId),
                sql`lower(trim(${entities.name})) = ${toNorm}`,
              ),
            )
            .limit(1);

          if (!fromEntity || !toEntity) continue;

          // Check for duplicate relationship
          const existingRel = await db
            .select()
            .from(relationships)
            .where(
              and(
                eq(relationships.sessionId, sessionId),
                eq(relationships.fromEntityId, fromEntity.id),
                eq(relationships.toEntityId, toEntity.id),
                eq(relationships.relationshipType, rel.relationship_type),
              ),
            )
            .limit(1);

          if (existingRel.length > 0) continue;

          await db.insert(relationships).values({
            sessionId,
            fromEntityId: fromEntity.id,
            toEntityId: toEntity.id,
            relationshipType: rel.relationship_type,
            sentiment: rel.sentiment || 'neutral',
            strength: Math.max(0, Math.min(1, rel.strength ?? 0.5)),
            sourceId: source.id,
          });
        }
      } catch (err) {
        console.error('[deepdive] Relationship extraction failed:', err);
      }
    }

    return newFacts;
  }
}
