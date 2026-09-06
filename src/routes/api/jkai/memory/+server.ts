import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiMemories } from '$lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { retrieveMemories } from '$lib/jkai/memory/retrieve.server';
import { writeMemory, forgetMemory, pinMemory } from '$lib/jkai/memory/service.server';
import { setMemoryLinks, backfillMemoryLinks, memoryLinks } from '$lib/jkai/memory/graph.server';

export const GET: RequestHandler = async ({ url }) => {
  if (url.searchParams.has('entities')) {
    const query = url.searchParams.get('entities') ?? '';
    const result = await db.execute(sql`SELECT e.id,e.name,t.name AS type FROM intel_entities e JOIN intel_entity_types t ON t.id=e.type_id WHERE e.merged_into_id IS NULL AND e.name ILIKE ${`%${query}%`} ORDER BY e.name LIMIT 30`);
    return json({ entities: result.rows });
  }
  let memories = await retrieveMemories(url.searchParams.get('q') ?? '', undefined, 100, { asOf: url.searchParams.get('asOf') || undefined });
  if (url.searchParams.get('format') === 'md') {
    const rows = await db.select().from(jkaiMemories).where(and(isNull(jkaiMemories.supersededBy),isNull(jkaiMemories.daydreamOrigin),
      sql`coalesce(${jkaiMemories.provenance}->>'scope','personal')='personal'`,
      sql`coalesce(${jkaiMemories.provenance}->>'validFrom',${jkaiMemories.createdAt}::text)::timestamptz <= now()`,
      sql`(${jkaiMemories.provenance}->>'validUntil' IS NULL OR (${jkaiMemories.provenance}->>'validUntil')::timestamptz > now())`));
    const links = await memoryLinks(rows.map(r=>r.id));
    memories=rows.map(r=>({...r,entities:links.filter(l=>l.memory_id===r.id),recalledBecause:'Export'}));
    const body = '# JKAI memory\n\nGenerated from the authoritative memory store.\n\n' + memories.map(m => `- ${m.content}\n  - ID: ${m.id}; origin: ${m.provenance?.origin ?? 'legacy'}; assertion: ${m.provenance?.assertion ?? 'unverified'}; valid from: ${m.provenance?.validFrom ?? m.createdAt.toISOString()}; valid until: ${m.provenance?.validUntil ?? 'open'}\n  - Entities: ${m.entities.map(e=>e.name).join(', ') || 'unlinked'}`).join('\n');
    return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="jkai-memory.md"', 'Cache-Control': 'no-store' } });
  }
  return json({ memories }, { headers: { 'Cache-Control': 'no-store' } });
};
const input = z.object({ action: z.enum(['save','correct','forget','pin','link','backfill']), id: z.string().optional(), content: z.string().min(1).max(12000).optional(), category: z.string().optional(),
  pinned: z.boolean().optional(), entityIds: z.array(z.string()).max(20).optional(), validFrom: z.string().optional(), validUntil: z.string().optional() });
export const POST: RequestHandler = async ({ request }) => {
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) throw error(400,'Invalid memory action');
  const body = parsed.data;
  try {
    if (body.action === 'backfill') return json(await backfillMemoryLinks());
    if (body.action === 'save') {
      if (!body.content || !body.category) throw new Error('Content and category are required');
      return json(await writeMemory({ content: body.content, category: body.category, entityIds: body.entityIds,
        provenance: { origin: 'user', assertion: 'stated', sourceId: `memory-editor:${crypto.randomUUID()}`, validFrom: body.validFrom, validUntil: body.validUntil } }));
    }
    if (!body.id) throw new Error('Memory ID is required');
    const [old] = await db.select().from(jkaiMemories).where(and(eq(jkaiMemories.id,body.id), isNull(jkaiMemories.daydreamOrigin), sql`coalesce(${jkaiMemories.provenance}->>'scope','personal')='personal'`));
    if (!old) throw new Error('Personal memory not found');
    if (body.action === 'forget') await forgetMemory(body.id);
    if (body.action === 'pin') await pinMemory(body.id, body.pinned === true);
    if (body.action === 'link') await db.transaction(async tx => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jkai-memory-write'))`); await setMemoryLinks(body.id!,body.entityIds ?? [],tx); });
    if (body.action === 'correct') {
      if (!body.content) throw new Error('Correction content is required');
      const links = await db.execute(sql`SELECT coalesce(e.merged_into_id,e.id) id FROM jkai_memory_entities l JOIN intel_entities e ON e.id=l.entity_id WHERE l.memory_id=${body.id}`);
      await writeMemory({ category: old.category, content: body.content, replacesId: old.id, entityIds: links.rows.map(r=>String(r.id)),
        provenance: { ...old.provenance, origin: 'user', assertion: 'stated', sourceId: `memory-editor:${crypto.randomUUID()}`, validFrom: body.validFrom ?? new Date().toISOString(), validUntil: body.validUntil } });
    }
    return json({ ok: true });
  } catch (err) { throw error(400,err instanceof Error ? err.message : 'Memory action failed'); }
};
