import { pgTextArray } from '$lib/db/sql-array';
import { afterAll, describe, it, expect, vi } from 'vitest';
vi.mock('$lib/jkai/intel/embed',()=>({generateEmbedding:async()=>{throw new Error('offline fixture')},embedEntity:async()=>{}}));
vi.mock('$lib/jkai/intel/analytics/load',()=>({invalidateGraphAnalysis:()=>{}}));
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { persistMention } from './ingestion.server';
import { loadEvidenceVersions, pairEvidenceVersion } from './evidence-version.server';
import { writeMemory,forgetMemory,pinMemory } from '$lib/jkai/memory/service.server';
import { retrieveMemories } from '$lib/jkai/memory/retrieve.server';
import { mergeEntities,unmergeEntity } from './merge';
import { memoryLinks } from '$lib/jkai/memory/graph.server';
import { changeTaxonomy,undoTaxonomy } from '../taxonomy-governance.server';
const enabled=process.env.JKAI_LOCAL_TESTS==='1' && /(?:127\.0\.0\.1:15435|jkai-db:5432)\/jkai_local/.test(process.env.DATABASE_URL??'');
const prefix=`overhaul-${crypto.randomUUID()}`;
const ids={person:`${prefix}-person`,org:`${prefix}-org`,project:`${prefix}-project`,note:`${prefix}-note`,other:`${prefix}-other`,alex:`${prefix}-alex`,alpha:`${prefix}-alpha`,north:`${prefix}-north`};
const memories:string[]=[],changes:string[]=[];
describe.skipIf(!enabled)('local intelligence and connected memory',()=>{
  it('seeds independent synthetic evidence',async()=>{
    for(const [id,name] of [[ids.person,'person'],[ids.org,'organisation'],[ids.project,'project']])await db.execute(sql`INSERT INTO intel_entity_types(id,name,status) VALUES(${id},${prefix+name},'active')`);
    await db.execute(sql`INSERT INTO intel_notes(id,raw_content,status,graph_state) VALUES(${ids.note},'Alex Smith leads Sample Project North. Sample Acme has a blue badge.','processed','admitted')`);
    await db.execute(sql`INSERT INTO intel_entities(id,name,type_id,properties) VALUES(${ids.alex},'Alex Smith',${ids.person},'{}'),(${ids.alpha},'Sample Acme',${ids.org},'{"colour":"blue"}'),(${ids.north},'Sample Project North',${ids.project},'{}')`);
  });
  it('does not accept an unverified model ID and retains property conflicts',async()=>{
    const id=await persistMention({name:'Alex Smith',type:'person',confidence:'high',properties:{},possibleMatchId:ids.alpha},ids.note,ids.person,'Alex Smith leads Sample Project North.');
    expect(id).toBe('');
    const org=await persistMention({name:'Sample Acme',type:'organisation',confidence:'high',properties:{colour:'red'},possibleMatchId:null},ids.note,ids.org,'Sample Acme has a red badge.');
    expect(org).toBe(ids.alpha);
    const check=await db.execute(sql`SELECT properties FROM intel_entities WHERE id=${ids.alpha}`);expect((check.rows[0].properties as {colour:string}).colour).toBe('blue');
    const claims=await db.execute(sql`SELECT status FROM intel_assertions WHERE entity_id=${ids.alpha}`);expect(claims.rows.some(r=>r.status==='conflict')).toBe(true);
  });
  it('recalls graph-linked personal facts, excludes private scopes and survives embedding outage',async()=>{
    const fact=await writeMemory({category:'situations',content:'The coordinator is available on Wednesdays.',entityIds:[ids.north],provenance:{origin:'user',assertion:'stated',sourceId:prefix}});memories.push(fact.id);
    const hidden=await writeMemory({category:'situations',content:'Sample Project North speculative private ruling',daydreamOrigin:'ruling',provenance:{origin:'daydream-ruling',assertion:'inferred',sourceId:prefix}});memories.push(hidden.id);
    const results=await retrieveMemories('Who coordinates Sample Project North?');
    expect(results.some(r=>r.id===fact.id && r.recalledBecause==='Connected entity')).toBe(true);
    expect(results.some(r=>r.id===hidden.id)).toBe(false);
    await pinMemory(fact.id,true);expect((await retrieveMemories('unrelated topic')).some(r=>r.id===fact.id && r.provenance?.pinned)).toBe(true);
  });
  it('supersedes assertions temporally, rejects inferred overwrite and forgets paraphrased source replays',async()=>{
    const original=await writeMemory({category:'places',content:'Synthetic resident lived in York.',sourceConversationId:prefix,provenance:{origin:'user',assertion:'stated',sourceId:prefix,validFrom:'2020-01-01'}});memories.push(original.id);
    await expect(writeMemory({category:'places',content:'Maybe moved.',replacesId:original.id,provenance:{origin:'extraction',assertion:'inferred',sourceId:prefix}})).rejects.toThrow('inference');
    const updated=await writeMemory({category:'places',content:'Synthetic resident lives in Leeds.',replacesId:original.id,provenance:{origin:'user',assertion:'stated',sourceId:prefix,validFrom:'2026-01-01'}});memories.push(updated.id);
    expect((await retrieveMemories('Synthetic resident',undefined,30,{asOf:'2025-01-01'})).some(r=>r.id===original.id)).toBe(true);
    expect((await retrieveMemories('Synthetic resident')).some(r=>r.id===original.id)).toBe(false);
    await forgetMemory(original.id);
    expect((await retrieveMemories('Synthetic resident')).some(r=>r.id===updated.id)).toBe(false);
    const replay=await writeMemory({category:'places',content:'Paraphrase: the resident is now in Leeds.',provenance:{origin:'extraction',assertion:'inferred',sourceId:prefix}});
    expect(replay.suppressed).toBe(true);
    const conversationReplay=await writeMemory({category:'places',content:'The old visit is paraphrased from another message.',sourceConversationId:prefix,provenance:{origin:'extraction',assertion:'inferred',sourceId:prefix+'-different-message'}});
    expect(conversationReplay.suppressed).toBe(true);
  });
  it('forgets historical derived assertions when their premise is forgotten',async()=>{
    const source=await writeMemory({category:'situations',content:'Synthetic source for derived history.',provenance:{origin:'user',assertion:'stated',sourceId:prefix,validFrom:'2020-01-01'}});memories.push(source.id);
    const derived=await writeMemory({category:'situations',content:'Synthetic inference before correction.',provenance:{origin:'extraction',assertion:'inferred',sourceId:prefix+'-derived',sourceMemoryIds:[source.id],validFrom:'2020-01-02'}});memories.push(derived.id);
    const replacement=await writeMemory({category:'situations',content:'Synthetic corrected inference.',replacesId:derived.id,provenance:{origin:'extraction',assertion:'inferred',sourceId:prefix+'-derived',sourceMemoryIds:[source.id],validFrom:'2026-01-01'}});memories.push(replacement.id);
    await forgetMemory(source.id);
    const recalled=await retrieveMemories('Synthetic inference',undefined,100,{asOf:'2025-01-01'});
    expect(recalled.some(r=>[derived.id,replacement.id].includes(r.id))).toBe(false);
  });
  it('replays a source without duplicating assertions' ,async()=>{
    const entity={name:'Sample Acme',type:'organisation',confidence:'high' as const,properties:{colour:'red'},possibleMatchId:null};
    await persistMention(entity,ids.note,ids.org,'Sample Acme has a red badge.');
    await persistMention(entity,ids.note,ids.org,'Sample Acme has a red badge.');
    const rows=await db.execute(sql`SELECT id FROM intel_assertions WHERE entity_id=${ids.alpha} AND predicate='colour'`);
    expect(rows.rows.length).toBe(1);
  });
  it('atomically merges and undoes source-category assignments',async()=>{
    const a=prefix+'-category-a',b=prefix+'-category-b';
    await db.execute(sql`INSERT INTO intel_categories(id,slug,name) VALUES(${a},${a},'Sample source'),(${b},${b},'Sample sources')`);
    try {
      await db.execute(sql`UPDATE intel_notes SET categories=${JSON.stringify([a,b])}::jsonb WHERE id=${ids.note}`);
      const change=await changeTaxonomy('category','merge',a,b);changes.push(change.id);
      expect((await db.execute(sql`SELECT categories FROM intel_notes WHERE id=${ids.note}`)).rows[0].categories).toEqual([b]);
      await undoTaxonomy(change.id);
      expect((await db.execute(sql`SELECT categories FROM intel_notes WHERE id=${ids.note}`)).rows[0].categories).toEqual([a,b]);
    } finally {await db.execute(sql`DELETE FROM intel_categories WHERE id IN (${a},${b})`);}
  });
  it('keeps memory identity links reversible across merge and unmerge',async()=>{
    const loser=prefix+'-loser';
    await db.execute(sql`INSERT INTO intel_entities(id,name,type_id) VALUES(${loser},'Sample Acme alias',${ids.org})`);
    const memory=await writeMemory({category:'situations',content:'Synthetic alias-associated memory',entityIds:[loser],provenance:{origin:'user',assertion:'stated',sourceId:prefix}});memories.push(memory.id);
    await mergeEntities(ids.alpha,loser);
    expect((await memoryLinks([memory.id]))[0].id).toBe(ids.alpha);
    await unmergeEntity(loser);
    expect((await memoryLinks([memory.id]))[0].id).toBe(loser);
  });
  it('versions actual source evidence',async()=>{
    await db.execute(sql`INSERT INTO intel_note_entities(note_id,entity_id,excerpt) VALUES(${ids.note},${ids.alpha},'Sample Acme has a blue badge.')`);
    const before=pairEvidenceVersion(ids.alpha,ids.alex,await loadEvidenceVersions());
    await db.execute(sql`UPDATE intel_notes SET raw_content='Sample Acme was renamed Sample Beta.' WHERE id=${ids.note}`);
    expect(pairEvidenceVersion(ids.alpha,ids.alex,await loadEvidenceVersions())).not.toBe(before);
  });
  it('undoes type merges and refuses taxonomy cycles',async()=>{
    const hierarchy=await changeTaxonomy('type','broader',ids.project,ids.org);changes.push(hierarchy.id);
    await expect(changeTaxonomy('type','broader',ids.org,ids.project)).rejects.toThrow('cycle');
    const merge=await changeTaxonomy('type','merge',ids.project,ids.org);changes.push(merge.id);
    expect((await db.execute(sql`SELECT type_id FROM intel_entities WHERE id=${ids.north}`)).rows[0].type_id).toBe(ids.org);
    await undoTaxonomy(merge.id);
    expect((await db.execute(sql`SELECT type_id FROM intel_entities WHERE id=${ids.north}`)).rows[0].type_id).toBe(ids.project);
  });
});
afterAll(async()=>{
 if(!enabled)return;
 await db.execute(sql`DELETE FROM jkai_memories WHERE id=ANY(${pgTextArray(memories)}::text[])`);
 await db.execute(sql`DELETE FROM intel_taxonomy_changes WHERE id=ANY(${pgTextArray(changes)}::text[])`);
 await db.execute(sql`DELETE FROM intel_taxonomy_links WHERE from_id LIKE ${prefix+'%'} OR into_id LIKE ${prefix+'%'}`);
 await db.execute(sql`DELETE FROM intel_entity_merges WHERE merged_id LIKE ${prefix+'%'} OR survivor_id LIKE ${prefix+'%'}`);
 await db.execute(sql`DELETE FROM intel_notes WHERE id=${ids.note}`);
 await db.execute(sql`DELETE FROM intel_entities WHERE id LIKE ${prefix+'%'}`);
 await db.execute(sql`DELETE FROM intel_entity_types WHERE id LIKE ${prefix+'%'}`);
});
