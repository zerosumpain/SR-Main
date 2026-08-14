import { db } from '$lib/db';
import { sources, facts, entities, entityMentions, relationships, researchLeads } from '$lib/db/schema';
import type { ResearchSession, Source } from '$lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { jsonCompletion, generateEmbedding } from './ai';
import { toVectorLiteral } from './vector';
import { extractContent } from './extract-content';
import { indexSourceContent } from './source-index';
import { getEmbeddingModel } from './keys';
import { search as tavilySearch } from './tavily';
import { emitLog, emitStats, shouldStop, throwIfStopped } from './worker';
import { emitArtefact } from './desk-events';
import { loadKeys } from './keys';
import { pLimit, getLlmConcurrencyLimit } from './concurrency';
import type { SessionConfig, SessionStats } from './types';
import { completeLead, measureAlignment, countConnectedEntities } from './frontier';
import { generateEmbedding as embedText } from './ai';

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function bigramSimilarity(a: string, b: string): number {
  const na = normalise(a);
  const nb = normalise(b);
  if (na === nb) return 1;
  const bigramsA = new Set<string>();
  for (let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2));
  const bigramsB = new Set<string>();
  for (let i = 0; i < nb.length - 1; i++) bigramsB.add(nb.slice(i, i + 2));
  let intersection = 0;
  for (const bg of bigramsA) if (bigramsB.has(bg)) intersection++;
  const union = bigramsA.size + bigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const embeddingsAvailable = (): boolean => !!loadKeys().openrouterApiKey;

async function isDuplicate(sessionId: string, content: string): Promise<{ duplicate: boolean; embedding: number[] | null }> {
  // Try embedding-based dedup via OpenRouter + pgvector
  if (embeddingsAvailable()) {
    try {
      const embedding = await generateEmbedding(content);
      const vectorStr = toVectorLiteral(embedding);

      const result = await db.execute(
        sql`SELECT id FROM fact
            WHERE session_id = ${sessionId}
              AND embedding IS NOT NULL
              AND embedding <=> ${vectorStr}::vector < 0.08
            LIMIT 1`,
      );

      return { duplicate: result.rows.length > 0, embedding };
    } catch (err) {
      console.error('[deepdive] Embedding dedup failed, falling back to bigram:', err);
    }
  }

  // Fallback: bigram similarity
  const existing = await db
    .select({ content: facts.content })
    .from(facts)
    .where(eq(facts.sessionId, sessionId));

  for (const row of existing) {
    if (bigramSimilarity(content, row.content) > 0.85) return { duplicate: true, embedding: null };
  }
  return { duplicate: false, embedding: null };
}

export async function runPhase2(
  sessionId: string,
  session: ResearchSession,
  isTimeUp: () => boolean,
): Promise<void> {
  const config = (session.config ?? {}) as SessionConfig;
  const depth = config.analysisDepth ?? 'standard';
  const goals = (session.goals ?? []) as string[];

  // Concurrency limiter: cap how many sources are processed in parallel to
  // avoid saturating the LLM provider with bursts of simultaneous LLM calls.
  // Each source fires up to 3 LLM calls (facts, NER, relationships).
  // Default 3 → ≤9 in-flight LLM calls at any time. Override via
  // DEEPDIVE_LLM_CONCURRENCY env var.
  const concurrencyLimit = pLimit(getLlmConcurrencyLimit());

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

  /**
   * Per-lead tallies. Phase 1 gathered the sources but could not judge the lead
   * that found them — novelty, alignment and connectivity are properties of
   * facts, which only exist once this phase has run. These accumulate here and
   * are settled at the end.
   */
  type Tally = {
    sourcesFound: number;
    novelFacts: number;
    duplicateFacts: number;
    novelEntityIds: string[];
    factEmbeddings: (number[] | null)[];
  };
  const tallies = new Map<string, Tally>();
  const tallyFor = (leadId: string): Tally => {
    let t = tallies.get(leadId);
    if (!t) {
      t = { sourcesFound: 0, novelFacts: 0, duplicateFacts: 0, novelEntityIds: [], factEmbeddings: [] };
      tallies.set(leadId, t);
    }
    return t;
  };

  // The anchor every branch is measured against: the question itself, not
  // whatever the first search happened to return. Without this an early wrong
  // turn becomes the reference point and the CORRECT material scores as drift.
  let anchor: number[] | null = null;
  try {
    anchor = await embedText([session.topic, ...goals].join('\n'));
  } catch {
    anchor = null; // Unjudgeable rather than wrongly judged.
  }

  // Process in batches of 8
  for (let i = 0; i < allSources.length; i += 8) {
    if (isTimeUp()) break;

    const batch = allSources.slice(i, i + 8);
    // Wrap each processSource call with the concurrency limiter so at most
    // DEEPDIVE_LLM_CONCURRENCY sources are analysed simultaneously.
    const batchPromises = batch.map((source) => concurrencyLimit(() => processSource(source)));

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

  // Every lead phase 1 claimed must reach a terminal state. Phase 2 stops early
  // on its own novelty check and on the budget, so some leads' sources are never
  // analysed — and a lead left `running` forever both lies on the graph and
  // looks like abandoned work to the resume sweep.
  const claimed = await db
    .select({ id: researchLeads.id, metrics: researchLeads.metrics })
    .from(researchLeads)
    .where(and(eq(researchLeads.sessionId, sessionId), eq(researchLeads.status, 'running')));

  for (const lead of claimed) {
    if (tallies.has(lead.id)) continue;
    await db
      .update(researchLeads)
      .set({
        status: 'stalled',
        reason: 'gathered sources, but the run ended before they were analysed',
        completedAt: new Date(),
      })
      .where(eq(researchLeads.id, lead.id));
  }

  // Settle each lead against what it actually produced. This is where a branch
  // is recognised as a dead end and its unstarted descendants are pruned, so a
  // run stops paying for a line of enquiry the moment it goes off-question
  // rather than when a global average finally sags.
  for (const [leadId, t] of tallies) {
    try {
      const verdict = await completeLead(sessionId, leadId, {
        sourcesFound: t.sourcesFound,
        novelFacts: t.novelFacts,
        duplicateFacts: t.duplicateFacts,
        novelEntities: t.novelEntityIds.length,
        connectedEntities: await countConnectedEntities(sessionId, t.novelEntityIds),
        goalAlignment: await measureAlignment(anchor, t.factEmbeddings),
        searchFailed: false,
      });
      if (verdict.status === 'drifted') {
        emitLog(sessionId, '\u{1F6AB}', `Abandoned a line of enquiry — ${verdict.reason}`);
      }
    } catch (err) {
      console.error('[deepdive] settling lead failed:', err);
    }
  }

  emitLog(sessionId, '\u2139\uFE0F', `Phase 2 complete: ${stats.factsExtracted} facts, ${stats.entitiesIdentified} entities`);

  async function processSource(source: Source): Promise<number> {
    if (isTimeUp()) return 0;

    emitLog(sessionId, '\u{1F50D}', `Analysing: ${source.title?.slice(0, 50) ?? source.url}`);
    if (source.leadId) tallyFor(source.leadId).sourcesFound++;

    // Fetch content — skip extraction if snippet is already rich
    let content = source.snippet ?? '';
    if (content.length < 500) {
      const result = await extractContent(source.url, content);
      content = result.content.slice(0, 10000);
      if (result.method !== 'snippet') {
        emitLog(sessionId, '\u{1F4E5}', `Extracted via ${result.method}: ${source.title?.slice(0, 40) ?? source.url}`);
      }
    }

    if (!content) return 0;
    throwIfStopped(sessionId);

    // Index the full source content into source_chunk so @research can retrieve
    // raw source passages the fact extractor doesn't distil into a fact. Non-fatal:
    // a failure here must never abort fact/entity extraction for this source.
    try {
      await indexSourceContent(sessionId, source, content);
    } catch (err) {
      console.warn('[deepdive] source-content indexing failed:', (err as Error).message);
    }

    const contentSlice = content.slice(0, 6000);
    const isShortContent = content.length < 1000;

    // For short content or shallow depth: combined fact+entity extraction in one call
    // For longer content at standard/deep: run fact extraction and NER in parallel
    let newFacts = 0;

    if (isShortContent || depth === 'shallow') {
      // Single combined LLM call
      try {
        const combinedResult = await jsonCompletion<{
          facts: { content: string; event_date: string | null; confidence: number; tags: string[] }[];
          entities: { name: string; type: string; description: string }[];
        }>(
          systemPrompt,
          `Analyse this source content. Return two things:\n\n1. FACTS: Extract all factual claims. For each:\n- content: the factual claim as a single clear sentence\n- event_date: ISO date string or null\n- confidence: 0.0-1.0\n- tags: 2-4 short topic tags\n\n2. ENTITIES: Named Entity Recognition. For each:\n- name: the entity name\n- type: one of person, organisation, location, event, concept, product, other\n- description: a one-sentence description\n\nSource: ${source.title}\nContent:\n${contentSlice}\n\nRespond with JSON: { "facts": [...], "entities": [...] }`,
          { maxTokens: 8192 },
        );

        newFacts = await storeFacts(combinedResult.facts ?? [], source);
        if (depth !== 'shallow') {
          await storeEntities(combinedResult.entities ?? [], source);
        }
      } catch (err) {
        console.error('[deepdive] Combined extraction failed:', err);
      }
    } else {
      // Parallel fact extraction + NER
      const [factResult, nerResult] = await Promise.allSettled([
        jsonCompletion<{
          facts: { content: string; event_date: string | null; confidence: number; tags: string[] }[];
        }>(
          systemPrompt,
          `Extract all factual claims from this source content. For each fact return:\n- content: the factual claim as a single clear sentence\n- event_date: best estimate of when this fact became true (ISO date string or null)\n- confidence: 0.0-1.0 based on how clearly the source supports it\n- tags: 2-4 short topic tags\n\nSource: ${source.title}\nContent:\n${contentSlice}\n\nRespond with JSON: { "facts": [...] }`,
          { maxTokens: 8192 },
        ),
        jsonCompletion<{
          entities: { name: string; type: string; description: string }[];
        }>(
          systemPrompt,
          `Perform Named Entity Recognition on this content. For each entity found, return:\n- name: the entity name\n- type: one of person, organisation, location, event, concept, product, other\n- description: a one-sentence description\n\nContent:\n${contentSlice}\n\nRespond with JSON: { "entities": [...] }`,
        ),
      ]);

      if (factResult.status === 'fulfilled') {
        newFacts = await storeFacts(factResult.value.facts ?? [], source);
      } else {
        console.error('[deepdive] Fact extraction failed:', factResult.reason);
      }

      if (nerResult.status === 'fulfilled') {
        await storeEntities(nerResult.value.entities ?? [], source);
      } else {
        console.error('[deepdive] NER failed:', nerResult.reason);
      }
    }

    emitLog(sessionId, '\u2705', `${newFacts} facts from: ${source.title?.slice(0, 40) ?? 'source'}`);

    async function storeFacts(
      extractedFacts: { content: string; event_date: string | null; confidence: number; tags: string[] }[],
      src: Source,
    ): Promise<number> {
      let count = 0;
      for (const f of extractedFacts) {
        if (!f.content || f.content.length < 10) continue;
        const { duplicate, embedding } = await isDuplicate(sessionId, f.content);
        if (src.leadId) {
          const t = tallyFor(src.leadId);
          if (duplicate) t.duplicateFacts++;
          else {
            t.novelFacts++;
            t.factEmbeddings.push(embedding);
          }
        }
        if (duplicate) continue;
        const extractedConf = Math.max(0, Math.min(1, f.confidence ?? 0.5));
        const srcCredibility = src.credibilityScore ?? 0.5;
        const blendedConfidence = extractedConf * 0.7 + srcCredibility * 0.3;
        const [storedFact] = await db
          .insert(facts)
          .values({
            sessionId,
            sourceId: src.id,
            content: f.content,
            eventDate: f.event_date ? new Date(f.event_date) : null,
            confidence: Math.max(0, Math.min(1, blendedConfidence)),
            tags: f.tags ?? [],
            embedding,
            embeddingModel: embedding ? getEmbeddingModel() : null,
          })
          .returning();

        // Desk: drop the fact card (stable id from .returning()).
        emitArtefact(sessionId, 'fact', 2, {
          id: storedFact.id,
          sourceId: storedFact.sourceId,
          content: storedFact.content,
          confidence: storedFact.confidence,
          isCounterfactual: storedFact.isCounterfactual,
          refutesFactId: storedFact.refutesFactId,
          tags: storedFact.tags,
          eventDate: storedFact.eventDate ? storedFact.eventDate.toISOString() : null,
        });

        count++;
        stats.factsExtracted++;
      }
      return count;
    }

    async function storeEntities(
      extractedEntities: { name: string; type: string; description: string }[],
      src: Source,
    ): Promise<void> {
      for (const e of extractedEntities) {
        if (!e.name) continue;
        const normalised = e.name.toLowerCase().trim();

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
          if (src.leadId) tallyFor(src.leadId).novelEntityIds.push(created.id);

          // Desk: drop the entity chip (only for newly-created entities).
          emitArtefact(sessionId, 'entity', 2, {
            id: created.id,
            name: created.name,
            type: created.type,
            description: created.description,
          });
        }

        const sourceFacts = await db
          .select()
          .from(facts)
          .where(and(eq(facts.sessionId, sessionId), eq(facts.sourceId, src.id)));

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
      emitLog(sessionId, '\u{1F9E9}', `Entities from: ${src.title?.slice(0, 40) ?? 'source'}`);
    }

    // Pass 3: Relationship extraction (Deep only)
    if (depth === 'deep' && !shouldStop(sessionId)) {
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

          const [storedRel] = await db
            .insert(relationships)
            .values({
              sessionId,
              fromEntityId: fromEntity.id,
              toEntityId: toEntity.id,
              relationshipType: rel.relationship_type,
              sentiment: rel.sentiment || 'neutral',
              strength: Math.max(0, Math.min(1, rel.strength ?? 0.5)),
              sourceId: source.id,
            })
            .returning();

          // Desk: relationships render as edges only (orthPath), never cards.
          emitArtefact(sessionId, 'relationship', 2, {
            id: storedRel.id,
            fromEntityId: storedRel.fromEntityId,
            toEntityId: storedRel.toEntityId,
            relationshipType: storedRel.relationshipType,
            sentiment: storedRel.sentiment,
            strength: storedRel.strength,
            sourceId: storedRel.sourceId,
          });
        }
      } catch (err) {
        console.error('[deepdive] Relationship extraction failed:', err);
      }
    }

    // Pass 4: LinkedIn relationship mapping (Deep only, for person entities)
    if (depth === 'deep' && !shouldStop(sessionId)) {
      try {
        // Find person entities from this source
        const sourcePersonEntities = await db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.sessionId, sessionId),
              eq(entities.type, 'person'),
            ),
          );

        // Only search for high-centrality persons we haven't searched yet (limit to 2 per source)
        const linkedinSearched = new Set<string>();
        for (const pe of sourcePersonEntities.slice(0, 2)) {
          if (linkedinSearched.has(pe.name.toLowerCase())) continue;
          linkedinSearched.add(pe.name.toLowerCase());

          try {
            const liResults = await tavilySearch(
              `site:linkedin.com/in/ "${pe.name}"`,
              { maxResults: 3, searchDepth: 'basic' },
            );

            if (liResults.results?.length > 0) {
              const topResult = liResults.results[0];

              // Try to extract profile content
              const profileResult = await extractContent(topResult.url, topResult.content ?? '');
              let profileContent = profileResult.content.slice(0, 5000);

              if (profileContent) {
                const liResult = await jsonCompletion<{
                  connections: { name: string; role: string; company: string; relationship: string }[];
                }>(
                  systemPrompt,
                  `Extract professional connections and relationships from this LinkedIn profile content for "${pe.name}". Return:\n- name: connected person's name\n- role: their job title\n- company: their company\n- relationship: nature of connection (e.g. "colleague at X", "co-founder", "reports to")\n\nProfile content:\n${profileContent.slice(0, 4000)}\n\nRespond with JSON: { "connections": [...] }. Return empty array if no clear connections found.`,
                  { maxTokens: 4096 },
                );

                for (const conn of liResult.connections ?? []) {
                  if (!conn.name) continue;

                  // Create or find the connected entity
                  const connNorm = conn.name.toLowerCase().trim();
                  const [existing] = await db
                    .select()
                    .from(entities)
                    .where(
                      and(
                        eq(entities.sessionId, sessionId),
                        sql`lower(trim(${entities.name})) = ${connNorm}`,
                      ),
                    )
                    .limit(1);

                  let connEntityId: string;
                  if (existing) {
                    connEntityId = existing.id;
                  } else {
                    const [created] = await db
                      .insert(entities)
                      .values({
                        sessionId,
                        name: conn.name,
                        type: 'person',
                        description: `${conn.role} at ${conn.company}`,
                      })
                      .returning();
                    connEntityId = created.id;
                    stats.entitiesIdentified++;
                  }

                  // Create relationship
                  await db.insert(relationships).values({
                    sessionId,
                    fromEntityId: pe.id,
                    toEntityId: connEntityId,
                    relationshipType: conn.relationship || 'connected_to',
                    sentiment: 'neutral',
                    strength: 0.5,
                    sourceId: source.id,
                  });
                }

                emitLog(sessionId, '\u{1F517}', `LinkedIn connections for: ${pe.name}`);
              }
            }
          } catch (err) {
            console.error('[deepdive] LinkedIn lookup failed for', pe.name, err);
          }
        }
      } catch (err) {
        console.error('[deepdive] LinkedIn pass failed:', err);
      }
    }

    return newFacts;
  }
}
