import { db } from '$lib/db';
import {
  entities,
  globalEntities,
  globalEntityLinks,
  researchSessions,
} from '$lib/db/schema';
import { eq, and, sql, ne } from 'drizzle-orm';
import { generateEmbedding } from './ai';
import { toVectorLiteral } from './vector';
import { hasOpenRouter } from '$lib/llm/keys';
import { emitLog } from './worker';

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

export async function linkSessionEntitiesToGlobal(sessionId: string): Promise<void> {
  const embeddingsAvailable = await hasOpenRouter();

  const sessionEntities = await db
    .select()
    .from(entities)
    .where(eq(entities.sessionId, sessionId));

  if (sessionEntities.length === 0) return;

  emitLog(sessionId, '\u2139\uFE0F', `Linking ${sessionEntities.length} entities to global knowledge base...`);

  for (const entity of sessionEntities) {
    // Check if already linked
    const existingLink = await db
      .select()
      .from(globalEntityLinks)
      .where(
        and(
          eq(globalEntityLinks.sessionEntityId, entity.id),
          eq(globalEntityLinks.sessionId, sessionId),
        ),
      )
      .limit(1);

    if (existingLink.length > 0) continue;

    let matchedGlobalId: string | null = null;
    let matchConfidence = 0;

    if (embeddingsAvailable) {
      // Embedding-based matching
      try {
        const entityText = `${entity.name}: ${entity.description ?? entity.type}`;
        const embedding = await generateEmbedding(entityText);
        const vectorStr = toVectorLiteral(embedding);

        const similar = await db.execute(
          sql`SELECT id, canonical_name, 1 - (embedding <=> ${vectorStr}::vector) as similarity
              FROM global_entity
              WHERE embedding IS NOT NULL
                AND 1 - (embedding <=> ${vectorStr}::vector) > 0.85
              ORDER BY embedding <=> ${vectorStr}::vector
              LIMIT 1`,
        );

        if (similar.rows.length > 0) {
          const row = similar.rows[0] as any;
          matchedGlobalId = row.id;
          matchConfidence = row.similarity;
        } else {
          // Create new global entity with embedding
          const [created] = await db
            .insert(globalEntities)
            .values({
              canonicalName: entity.name,
              type: entity.type,
              description: entity.description,
              embedding,
            })
            .returning();
          matchedGlobalId = created.id;
          matchConfidence = 1.0;
        }
      } catch (err) {
        console.error('[deepdive] Embedding-based entity matching failed:', err);
      }
    }

    // Fallback: name-based matching
    if (!matchedGlobalId) {
      const allGlobal = await db
        .select({ id: globalEntities.id, canonicalName: globalEntities.canonicalName })
        .from(globalEntities)
        .where(eq(globalEntities.type, entity.type));

      for (const ge of allGlobal) {
        const sim = bigramSimilarity(entity.name, ge.canonicalName);
        if (sim > 0.8 && sim > matchConfidence) {
          matchedGlobalId = ge.id;
          matchConfidence = sim;
        }
      }

      if (!matchedGlobalId) {
        // Create new global entity without embedding
        const [created] = await db
          .insert(globalEntities)
          .values({
            canonicalName: entity.name,
            type: entity.type,
            description: entity.description,
          })
          .returning();
        matchedGlobalId = created.id;
        matchConfidence = 1.0;
      }
    }

    // Create the link
    await db.insert(globalEntityLinks).values({
      globalEntityId: matchedGlobalId,
      sessionEntityId: entity.id,
      sessionId,
      confidence: matchConfidence,
    });
  }

  emitLog(sessionId, '\u2139\uFE0F', 'Global entity linking complete');
}

export async function findRelatedSessions(
  sessionId: string,
): Promise<{ sessionId: string; topic: string; overlapScore: number; sharedEntities: string[] }[]> {
  // Find global entities linked to this session
  const myLinks = await db
    .select({ globalEntityId: globalEntityLinks.globalEntityId })
    .from(globalEntityLinks)
    .where(eq(globalEntityLinks.sessionId, sessionId));

  if (myLinks.length === 0) return [];

  const myGlobalIds = new Set(myLinks.map((l) => l.globalEntityId));

  // Find other sessions that share these global entities
  const otherLinks = await db
    .select({
      sessionId: globalEntityLinks.sessionId,
      globalEntityId: globalEntityLinks.globalEntityId,
    })
    .from(globalEntityLinks)
    .where(ne(globalEntityLinks.sessionId, sessionId));

  const sessionOverlap = new Map<string, Set<string>>();
  for (const link of otherLinks) {
    if (!myGlobalIds.has(link.globalEntityId)) continue;
    if (!sessionOverlap.has(link.sessionId)) sessionOverlap.set(link.sessionId, new Set());
    sessionOverlap.get(link.sessionId)!.add(link.globalEntityId);
  }

  if (sessionOverlap.size === 0) return [];

  // Get session topics and entity names
  const results: { sessionId: string; topic: string; overlapScore: number; sharedEntities: string[] }[] = [];

  for (const [otherSessionId, sharedGlobalIds] of sessionOverlap) {
    const [session] = await db
      .select({ topic: researchSessions.topic })
      .from(researchSessions)
      .where(eq(researchSessions.id, otherSessionId))
      .limit(1);

    if (!session) continue;

    // Get entity names
    const entityNames: string[] = [];
    for (const gid of sharedGlobalIds) {
      const [ge] = await db
        .select({ canonicalName: globalEntities.canonicalName })
        .from(globalEntities)
        .where(eq(globalEntities.id, gid))
        .limit(1);
      if (ge) entityNames.push(ge.canonicalName);
    }

    results.push({
      sessionId: otherSessionId,
      topic: session.topic,
      overlapScore: sharedGlobalIds.size / myGlobalIds.size,
      sharedEntities: entityNames,
    });
  }

  return results.sort((a, b) => b.overlapScore - a.overlapScore);
}
