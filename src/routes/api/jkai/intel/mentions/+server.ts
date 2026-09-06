import { pgTextArray } from '$lib/db/sql-array';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelMentions, intelEntities, intelNotes, intelAssertions } from '$lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { canonicalName } from '$lib/jkai/intel/resolve/match';
import { persistExtraction } from '$lib/jkai/intel/graph';
import type { ExtractionResult } from '$lib/jkai/intel/extract';
export const GET: RequestHandler = async () => {
  const result=await db.execute(sql`SELECT m.*,n.title AS note_title FROM intel_mentions m JOIN intel_notes n ON n.id=m.note_id WHERE m.status='unresolved' ORDER BY m.created_at DESC LIMIT 100`);
  const ids = [...new Set(result.rows.flatMap(r => (r.candidates as Array<{id:string}>).map(c=>c.id)))];
  const entities = ids.length ? await db.execute(sql`SELECT id,name,summary,properties->>'email' AS email FROM intel_entities WHERE id=ANY(${pgTextArray(ids)}::text[])`) : {rows:[]};
  const names = new Map(entities.rows.map(r=>[r.id,r]));
  const assertions=await db.execute(sql`SELECT a.id,a.predicate,a.value,e.name,e.properties->a.predicate AS current_value,n.title AS source FROM intel_assertions a JOIN intel_entities e ON e.id=a.entity_id LEFT JOIN intel_notes n ON n.id=a.note_id WHERE a.status IN ('conflict','unsupported') ORDER BY a.created_at DESC LIMIT 50`);
  return json({ assertions:assertions.rows, mentions: result.rows.map(r=>({...r,candidates:(r.candidates as Array<{id:string}>).map(c=>({...c,name:names.get(c.id)?.name??'Unavailable entity',detail:names.get(c.id)?.email??names.get(c.id)?.summary??'Open entity to inspect its source evidence'}))})) });
};
export const POST: RequestHandler = async ({request}) => {
  const body=await request.json();
  if (['accept-assertion','reject-assertion'].includes(body.action) && typeof body.id==='string') {
    await db.transaction(async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('intel-identity-write'))`);
      const [assertion]=await tx.select().from(intelAssertions).where(eq(intelAssertions.id,body.id));
      if (!assertion || !['conflict','unsupported'].includes(assertion.status)) throw error(409,'Assertion already reviewed');
      if (body.action==='accept-assertion') {
        const original=await tx.execute(sql`SELECT properties->${assertion.predicate} AS value,coalesce(merged_into_id,id) AS target FROM intel_entities WHERE id=${assertion.entityId}`);
        const target=String(original.rows[0]?.target??'');
        if (!target) throw error(409,'Entity no longer exists');
        const current=await tx.execute(sql`SELECT properties->${assertion.predicate} AS value FROM intel_entities WHERE id=${target}`);
        if (current.rows[0].value !== null) await tx.insert(intelAssertions).values({entityId:target,predicate:assertion.predicate,value:current.rows[0].value,status:'superseded'});
        await tx.execute(sql`UPDATE intel_entities SET properties=jsonb_set(coalesce(properties,'{}'),ARRAY[${assertion.predicate}]::text[],${JSON.stringify(assertion.value)}::jsonb),summary=NULL,embedding=NULL,updated_at=now() WHERE id=${target}`);
      }
      await tx.update(intelAssertions).set({status:body.action==='accept-assertion'?'accepted':'rejected'}).where(eq(intelAssertions.id,assertion.id));
    });
    const { invalidateResolutionCaches } = await import('$lib/jkai/intel/resolve/merge');
    const { invalidateGraphAnalysis } = await import('$lib/jkai/intel/analytics/load');
    invalidateResolutionCaches();invalidateGraphAnalysis();
    return json({ok:true});
  }
  if(!['link','create','reject'].includes(body.action)||typeof body.id!=='string')throw error(400,'Invalid mention action');
  const noteId=await db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('intel-identity-write'))`);
    const [mention]=await tx.select().from(intelMentions).where(and(eq(intelMentions.id,body.id),eq(intelMentions.status,'unresolved')));
    if(!mention)throw error(409,'Mention already reviewed');
    let entityId: string|null=null;
    if(body.action==='link'){
      const [entity]=await tx.select().from(intelEntities).where(and(eq(intelEntities.id,String(body.entityId)),isNull(intelEntities.mergedIntoId)));
      if(!entity)throw error(400,'Active entity not found');entityId=entity.id;
    }
    if(body.action==='create'){
      const type=await tx.execute(sql`SELECT id FROM intel_entity_types WHERE name=${mention.proposedType} AND status='active' LIMIT 1`);
      if(!type.rows.length)throw error(400,'Admit or select an active type first');
      const [entity]=await tx.insert(intelEntities).values({name:mention.surface,canonicalName:canonicalName(mention.surface),typeId:String(type.rows[0].id),confirmed:true,firstSeenIn:mention.noteId}).returning();entityId=entity.id;
    }
    await tx.update(intelMentions).set({entityId,status:body.action==='reject'?'rejected':'reviewed',reason:'Human review'}).where(eq(intelMentions.id,mention.id));
    return mention.noteId;
  });
  const [note]=await db.select().from(intelNotes).where(eq(intelNotes.id,noteId));
  // Replay saved extraction, including relationships, without another model call.
  const extraction=note?.metadata?.lastExtraction as ExtractionResult|undefined;
  if(extraction)await persistExtraction(noteId,extraction);
  return json({ok:true});
};
