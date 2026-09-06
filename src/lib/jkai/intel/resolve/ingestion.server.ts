import { pgTextArray } from '$lib/db/sql-array';
import { db, type DbExecutor } from '$lib/db';
import { intelEntities, intelMentions, intelAssertions } from '$lib/db/schema';
import { eq, sql, and, isNull } from 'drizzle-orm';
import { canonicalName, type ResolvableEntity } from './match';
import { assessIdentity, chooseIdentity, groundMention } from './policy';
import { generateEmbedding } from '../embed';
import type { ExtractedEntity } from '../extract';

/** Per-mention lexical, identifier and contextual candidate retrieval, bounded independently. */
export async function mentionCandidates(entity: ExtractedEntity, executor: DbExecutor = db, semantic = true): Promise<Array<ResolvableEntity & { semanticDistance?: number }>> {
  const names = [entity.name, entity.mention?.text].filter(Boolean).map(n => n!.toLowerCase());
  const email = typeof entity.properties.email === 'string' ? entity.properties.email.toLowerCase() : '';
  const rows = await executor.execute(sql`
    SELECT e.*, t.name AS type_name FROM intel_entities e JOIN intel_entity_types t ON t.id=e.type_id
    WHERE e.merged_into_id IS NULL AND (lower(e.name) = ANY(${pgTextArray(names)}::text[])
      OR e.canonical_name = ${canonicalName(entity.name)} OR e.id = ${entity.possibleMatchId ?? ''}
      OR (${email} <> '' AND lower(e.properties->>'email') = ${email})
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.aliases) a WHERE lower(a) = ANY(${pgTextArray(names)}::text[]))
      OR to_tsvector('english', e.name) @@ plainto_tsquery('english', ${entity.name})) LIMIT 40`);
  const all = rows.rows as Record<string, unknown>[];
  if (semantic) {
    try {
      const vec = await generateEmbedding(`${entity.name}\n${entity.mention?.context ?? entity.mention?.text ?? ''}`);
      const nearest = await executor.execute(sql`SELECT e.*, e.embedding <=> ${JSON.stringify(vec)}::vector AS distance, t.name AS type_name FROM intel_entities e JOIN intel_entity_types t ON t.id=e.type_id
        WHERE e.merged_into_id IS NULL AND e.embedding IS NOT NULL ORDER BY e.embedding <=> ${JSON.stringify(vec)}::vector LIMIT 8`);
      for (const r of nearest.rows as Record<string, unknown>[]) if (!all.some(a => a.id === r.id)) all.push(r);
    } catch { /* Exact identity candidates remain available offline. */ }
  }
  return all.map(r => ({ id: String(r.id), name: String(r.name), typeId: String(r.type_id), typeName: String(r.type_name),
    properties: (r.properties ?? {}) as Record<string, unknown>, aliases: (r.aliases ?? []) as string[], summary: r.summary as string | null,
    embedding: null, degree: 0, noteCount: 0, semanticDistance: typeof r.distance === 'number' ? r.distance : undefined }));
}

export async function resolveMention(entity: ExtractedEntity, typeId: string, executor: DbExecutor = db, semantic = true) {
  const candidates = await mentionCandidates(entity, executor, semantic);
  const fresh: ResolvableEntity = { id: 'incoming-mention', name: entity.mention?.text ?? entity.name, typeId, typeName: entity.type,
    properties: entity.properties, embedding: null, degree: 0, noteCount: 0 };
  // Count sender identities including merged records, rather than trusting a shared notification address.
  const identities = await executor.execute(sql`SELECT lower(properties->>'email') AS email, count(DISTINCT lower(name))::int AS n
    FROM intel_entities WHERE properties->>'email' IS NOT NULL GROUP BY lower(properties->>'email')`);
  const addressIdentities = new Map((identities.rows as {email: string; n: number}[]).map(r => [r.email, r.n]));
  return chooseIdentity(candidates.map(candidate => {
    let assessment=assessIdentity(fresh,candidate,{addressIdentities});
    if (assessment.score<0.35 && (candidate.semanticDistance??1)<0.18) assessment={...assessment,score:0.4,reason:'Similar contextual meaning; identity needs source evidence'};
    return {entity:candidate,assessment};
  }));
}

export async function persistMention(entity: ExtractedEntity, noteId: string, typeId: string, text: string): Promise<string> {
  const span = groundMention(text, entity.name, entity.mention);
  // Embedding/provider work is outside the write transaction.
  const identityEntity = { ...entity, mention: span ? { ...entity.mention, text: span.surface, context: span.excerpt } : entity.mention, properties: { ...entity.properties } };
  if (typeof identityEntity.properties.email === 'string' && !span?.excerpt.toLowerCase().includes(identityEntity.properties.email.toLowerCase())) delete identityEntity.properties.email;
  const resolved = await resolveMention(identityEntity, typeId);
  const id = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('intel-identity-write'))`);
    const [previous] = await tx.select().from(intelMentions).where(and(eq(intelMentions.noteId,noteId),eq(intelMentions.surface,span?.surface ?? entity.name),span ? eq(intelMentions.start,span.start) : isNull(intelMentions.start))).limit(1);
    if (previous?.status === 'rejected') return '';
    let previousTarget: string | null = null;
    if (previous?.entityId && previous.excerpt === span?.excerpt && previous.proposedType === entity.type) {
      const [target] = await tx.select().from(intelEntities).where(eq(intelEntities.id,previous.entityId));
      previousTarget = target?.mergedIntoId ?? target?.id ?? null;
    }
    // Repeat deterministic retrieval inside the lock to observe concurrent insertions.
    const current = await resolveMention(identityEntity, typeId, tx, false);
    // Retain contextual review candidates while only fresh, locked evidence can bind an identity.
    const contextual = resolved.ranked.filter(c => !current.ranked.some(fresh => fresh.entity.id === c.entity.id));
    const choice = chooseIdentity([...current.ranked, ...contextual.map(c => ({
      ...c, assessment: { ...c.assessment, canLink: false, score: Math.min(c.assessment.score, 0.84) }
    }))]);
    let entityId: string | null = null;
    const outcome = previousTarget ? 'link' : span ? choice.outcome : 'unresolved';
    if (previousTarget) entityId = previousTarget;
    else if (outcome === 'link' && choice.entity) {
      const [live] = await tx.select().from(intelEntities).where(and(eq(intelEntities.id, choice.entity.id), isNull(intelEntities.mergedIntoId)));
      if (live) entityId = live.id;
    } else if (outcome === 'new') {
      const [row] = await tx.insert(intelEntities).values({ name: entity.name, canonicalName: canonicalName(entity.name), typeId,
        properties: identityEntity.properties, confidence: entity.confidence, confirmed: false, firstSeenIn: noteId }).returning();
      entityId = row.id;
    }
    const mentionRecord = { noteId, entityId, surface: span?.surface ?? entity.name, start: span?.start, end: span?.end,
      excerpt: span?.excerpt, proposedType: entity.type, status: previous?.status === 'reviewed' && previousTarget ? 'reviewed' : entityId ? outcome : 'unresolved',
      reason: span ? choice.reason : 'No verifiable mention in source',
      candidates: choice.ranked.map(c => ({ id: c.entity.id, score: c.assessment.score, reason: c.assessment.reason })) };
    if (previous) await tx.update(intelMentions).set(mentionRecord).where(eq(intelMentions.id,previous.id));
    else await tx.insert(intelMentions).values(mentionRecord);
    if (entityId) {
      const [existing] = await tx.select().from(intelEntities).where(eq(intelEntities.id, entityId));
      const props = { ...(existing.properties ?? {}) };
      for (const [predicate, value] of Object.entries(entity.properties)) {
        if (['__proto__','constructor','prototype'].includes(predicate)) continue;
        const unsupported = predicate === 'email' && !Object.hasOwn(identityEntity.properties,'email');
        const conflict = Object.hasOwn(props,predicate) && JSON.stringify(props[predicate]) !== JSON.stringify(value);
        const [assertion] = await tx.select({id:intelAssertions.id}).from(intelAssertions).where(and(eq(intelAssertions.entityId,entityId),eq(intelAssertions.noteId,noteId),eq(intelAssertions.predicate,predicate),sql`${intelAssertions.value} = ${JSON.stringify(value)}::jsonb`)).limit(1);
        if (!assertion) await tx.insert(intelAssertions).values({ entityId, noteId, predicate, value, status: unsupported ? 'unsupported' : conflict ? 'conflict' : 'observed' });
        if (!unsupported && !Object.hasOwn(props,predicate)) props[predicate] = value;
      }
      await tx.update(intelEntities).set({ properties: props, updatedAt: new Date() }).where(eq(intelEntities.id, entityId));
    }
    return entityId ?? '';
  });
  if (id) {
    const { invalidateResolutionCaches } = await import('./merge');
    invalidateResolutionCaches();
    void import('../embed').then(m => m.embedEntity(id)).catch(() => {});
  }
  return id;
}
