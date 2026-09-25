import { pgTextArray } from '$lib/db/sql-array';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelMentions, intelEntities, intelNotes, intelAssertions } from '$lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { canonicalName } from '$lib/jkai/intel/resolve/match';
import { persistExtraction } from '$lib/jkai/intel/graph';
import type { ExtractionResult } from '$lib/jkai/intel/extract';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';
import { spaceIn } from '$lib/jkai/intel/scope';
// Mentions and assertions carry no space of their own: a mention is its note's,
// an assertion its entity's. So every query below scopes THROUGH that join, and
// the candidate entities a mention offers are only those the reader can see.
export const GET: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const result=await db.execute(sql`SELECT m.*,n.title AS note_title FROM intel_mentions m JOIN intel_notes n ON n.id=m.note_id WHERE m.status='unresolved' AND ${spaceIn(sql`n.space_id`, scope)} ORDER BY m.created_at DESC LIMIT 100`);
  const ids = [...new Set(result.rows.flatMap(r => (r.candidates as Array<{id:string}>).map(c=>c.id)))];
  const entities = ids.length ? await db.execute(sql`SELECT id,name,summary,properties->>'email' AS email FROM intel_entities WHERE id=ANY(${pgTextArray(ids)}::text[]) AND ${spaceIn(sql`space_id`, scope)}`) : {rows:[]};
  const names = new Map(entities.rows.map(r=>[r.id,r]));
  const assertions=await db.execute(sql`SELECT a.id,a.predicate,a.value,e.name,e.properties->a.predicate AS current_value,n.title AS source FROM intel_assertions a JOIN intel_entities e ON e.id=a.entity_id LEFT JOIN intel_notes n ON n.id=a.note_id AND ${spaceIn(sql`n.space_id`, scope)} WHERE a.status IN ('conflict','unsupported') AND ${spaceIn(sql`e.space_id`, scope)} ORDER BY a.created_at DESC LIMIT 50`);
  return json({ assertions:assertions.rows, mentions: result.rows.map(r=>({...r,candidates:(r.candidates as Array<{id:string}>).map(c=>({...c,name:names.get(c.id)?.name??'Unavailable entity',detail:names.get(c.id)?.email??names.get(c.id)?.summary??'Open entity to inspect its source evidence'}))})) });
};
export const POST: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const body=await event.request.json();
  if (['accept-assertion','reject-assertion'].includes(body.action) && typeof body.id==='string') {
    await db.transaction(async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('intel-identity-write'))`);
      // In scope through its entity: an assertion about an entity the reader
      // cannot see is not found (404), not "already reviewed".
      const [found]=await tx.select({assertion:intelAssertions}).from(intelAssertions).innerJoin(intelEntities,eq(intelEntities.id,intelAssertions.entityId)).where(and(eq(intelAssertions.id,body.id),spaceIn(intelEntities.spaceId,scope)));
      if (!found) throw error(404,'Assertion not found');
      const assertion=found.assertion;
      if (!['conflict','unsupported'].includes(assertion.status)) throw error(409,'Assertion already reviewed');
      if (body.action==='accept-assertion') {
        const original=await tx.execute(sql`SELECT properties->${assertion.predicate} AS value,coalesce(merged_into_id,id) AS target FROM intel_entities WHERE id=${assertion.entityId} AND ${spaceIn(sql`space_id`, scope)}`);
        const target=String(original.rows[0]?.target??'');
        if (!target) throw error(409,'Entity no longer exists');
        // A merge never crosses spaces, so the survivor is in scope too; the
        // predicate makes that a check rather than an assumption.
        const current=await tx.execute(sql`SELECT properties->${assertion.predicate} AS value FROM intel_entities WHERE id=${target} AND ${spaceIn(sql`space_id`, scope)}`);
        if (!current.rows.length) throw error(409,'Entity no longer exists');
        if (current.rows[0].value !== null) await tx.insert(intelAssertions).values({entityId:target,predicate:assertion.predicate,value:current.rows[0].value,status:'superseded'});
        await tx.execute(sql`UPDATE intel_entities SET properties=jsonb_set(coalesce(properties,'{}'),ARRAY[${assertion.predicate}]::text[],${JSON.stringify(assertion.value)}::jsonb),summary=NULL,embedding=NULL,updated_at=now() WHERE id=${target} AND ${spaceIn(sql`space_id`, scope)}`);
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
    // In scope through its note (a mention has no space of its own); outside
    // it the mention is not found (404), not "already reviewed".
    const [found]=await tx.select({mention:intelMentions,space:intelNotes.spaceId}).from(intelMentions).innerJoin(intelNotes,eq(intelNotes.id,intelMentions.noteId)).where(and(eq(intelMentions.id,body.id),spaceIn(intelNotes.spaceId,scope)));
    if(!found)throw error(404,'Mention not found');
    const mention=found.mention;
    if(mention.status!=='unresolved')throw error(409,'Mention already reviewed');
    let entityId: string|null=null;
    if(body.action==='link'){
      // Only an entity in the NOTE's space: linking a mention to another
      // space's entity would join two graphs neither reader owns outright.
      const [entity]=await tx.select().from(intelEntities).where(and(eq(intelEntities.id,String(body.entityId)),isNull(intelEntities.mergedIntoId),eq(intelEntities.spaceId,found.space)));
      if(!entity)throw error(400,'Active entity not found');entityId=entity.id;
    }
    if(body.action==='create'){
      const type=await tx.execute(sql`SELECT id FROM intel_entity_types WHERE name=${mention.proposedType} AND status='active' LIMIT 1`);
      if(!type.rows.length)throw error(400,'Admit or select an active type first');
      const [entity]=await tx.insert(intelEntities).values({name:mention.surface,canonicalName:canonicalName(mention.surface),typeId:String(type.rows[0].id),confirmed:true,firstSeenIn:mention.noteId,spaceId:found.space}).returning();entityId=entity.id;
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
