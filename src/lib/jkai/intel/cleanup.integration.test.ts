import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { cleanupIntelligence } from './cleanup.server';

vi.mock('./analytics/load', () => ({ invalidateGraphAnalysis: vi.fn() }));
vi.mock('./resolve/merge', () => ({ invalidateResolutionCaches: vi.fn() }));
vi.mock('./embed', () => ({ embedNote: vi.fn(), embedEntity: vi.fn(), generateEmbedding: vi.fn() }));
const extract = vi.hoisted(() => vi.fn());
vi.mock('./extract', () => ({ extractFromNote: extract }));

const enabled = process.env.JKAI_LOCAL_TESTS === '1' && /(?:127\.0\.0\.1:15435|jkai-db:5432)\/jkai_local/.test(process.env.DATABASE_URL ?? '');
let prefix = '';
const id = (name: string) => `${prefix}-${name}`;
async function seed() {
  prefix = `cleanup-test-${crypto.randomUUID()}`;
  await db.execute(sql`INSERT INTO intel_entity_types(id,name) VALUES(${prefix},${prefix})`);
}
async function note(name: string, file?: string, source = 'file') {
  await db.execute(sql`INSERT INTO intel_notes(id,title,raw_content,status,graph_state,source,metadata)
    VALUES(${id(name)},${name},'Synthetic cleanup source','processed','admitted',${source},${JSON.stringify(file ? { autoKind: 'file', refId: id(file) } : {})}::jsonb)`);
}
async function file(name: string, path = 'excluded') {
  await db.execute(sql`INSERT INTO workflow_files(id,name,mime_type,size_bytes,disk_path) VALUES(${id(name)},${prefix+'/'+path+'/'+name+'.txt'},'text/plain',0,'/synthetic-no-bytes')`);
}
async function entity(name: string, origin?: string) {
  await db.execute(sql`INSERT INTO intel_entities(id,name,type_id,first_seen_in,summary,properties,updated_at)
    VALUES(${id(name)},${name},${prefix},${origin ? id(origin) : null},'Excluded secret', '{"secret":"excluded"}',now()-interval '2 days')`);
}
async function link(n: string, e: string, excerpt = 'Surviving source excerpt') {
  await db.execute(sql`INSERT INTO intel_note_entities(note_id,entity_id,excerpt) VALUES(${id(n)},${id(e)},${excerpt})`);
}
async function exclude(path = 'excluded') {
  await db.execute(sql`INSERT INTO drive_folder_settings(path,intel_mode) VALUES(${prefix+'/'+path},'exclude')`);
}
async function exists(table: 'intel_entities' | 'intel_notes', name: string) {
  return (await db.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE id=${id(name)}`)).rows.length === 1;
}

// No production data or connected providers. Every fixture is scoped and removed.
describe.skipIf(!enabled)('local graph cleanup', () => {
  afterEach(async () => {
    if (!prefix) return;
    await db.execute(sql`DELETE FROM intel_dossiers WHERE id LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM jkai_memories WHERE id LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM intel_insights WHERE id LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM intel_entities WHERE type_id=${prefix}`);
    await db.execute(sql`DELETE FROM intel_notes WHERE id LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM workflow_files WHERE id LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM drive_folder_settings WHERE path LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM intel_entity_types WHERE id=${prefix}`);
    prefix = '';
  });

  it('previews without writes, honors inheritance, excludes missing files and preserves Gmail', async () => {
    await seed(); await exclude();
    await file('excluded'); await file('included','excluded/keep');
    await db.execute(sql`INSERT INTO drive_folder_settings(path,intel_mode) VALUES(${prefix+'/excluded/keep'},'include')`);
    await note('excluded-note','excluded'); await note('included-note','included'); await note('missing-note','missing');
    await note('email-note','gmail-source','email');
    await entity('unique','excluded-note'); await link('excluded-note','unique');
    const preview = await cleanupIntelligence({ pathPrefix: prefix });
    expect(preview.applied).toBe(false); expect(preview.counts.notesRemoved).toBe(1);
    expect(await exists('intel_notes','excluded-note')).toBe(true);
    const applied = await cleanupIntelligence({ apply:true, fileIds:['excluded','included','missing','gmail-source'].map(id) });
    expect(applied.counts.notesRemoved).toBeGreaterThanOrEqual(2);
    expect(await exists('intel_notes','excluded-note')).toBe(false);
    expect(await exists('intel_notes','missing-note')).toBe(false);
    expect(await exists('intel_entities','unique')).toBe(false);
    expect(await exists('intel_notes','included-note')).toBe(true);
    expect(await exists('intel_notes','email-note')).toBe(true);
    const again = await cleanupIntelligence({ apply:true, fileIds:['excluded','included','missing','gmail-source'].map(id) });
    expect(again.counts.notesRemoved).toBe(0); expect(again.counts.entitiesRemoved).toBe(0);
  });

  it('refreshes shared facts and summaries, removes old insights, retains owner-kept entities', async () => {
    await seed(); await exclude(); await file('source'); await note('gone','source'); await note('kept',undefined,'web');
    for (const name of ['shared','watched','confirmed','owner']) { await entity(name,'gone'); await link('gone',name); }
    await link('kept','shared','Remaining evidence only.');
    await db.execute(sql`UPDATE intel_entities SET watched=true WHERE id=${id('watched')}`);
    await db.execute(sql`UPDATE intel_entities SET confirmed=true WHERE id=${id('confirmed')}`);
    await db.execute(sql`INSERT INTO intel_assertions(entity_id,note_id,predicate,value,status) VALUES
      (${id('shared')},${id('gone')},'secret','"excluded"','observed'),
      (${id('shared')},${id('kept')},'role','"gardener"','conflict'),
      (${id('owner')},NULL,'$owner-summary','"Owner description"','accepted'),
      (${id('owner')},NULL,'custom','"Owner value"','accepted')`);
    await entity('shared-alias');
    await db.execute(sql`UPDATE intel_entities SET merged_into_id=${id('shared')} WHERE id=${id('shared-alias')}`);
    const r = await cleanupIntelligence({ apply:true, pathPrefix:prefix });
    expect(r.counts.entitiesRemoved).toBe(0); expect(r.counts.entitiesProtected).toBe(3);
    const shared = (await db.execute(sql`SELECT summary,properties,corroboration,embedding FROM intel_entities WHERE id=${id('shared')}`)).rows[0];
    expect(shared).toMatchObject({ summary:'Remaining evidence only.',properties:{ role:'gardener' },corroboration:1,embedding:null });
    const owner = (await db.execute(sql`SELECT summary,properties FROM intel_entities WHERE id=${id('owner')}`)).rows[0];
    expect(owner).toEqual({ summary:'Owner description',properties:{ custom:'Owner value' } });
    expect(await exists('intel_entities','shared-alias')).toBe(true);
    expect(await exists('intel_entities','watched')).toBe(true);
    expect(await exists('intel_entities','confirmed')).toBe(true);
  });

  it('grooms proven old extraction debris, keeps recent and supported nodes, flags unknown provenance', async () => {
    await seed(); await note('origin',undefined,'web');
    await entity('old','origin'); await entity('recent','origin'); await entity('manual'); await entity('isolated','origin');
    await db.execute(sql`UPDATE intel_entities SET updated_at=now() WHERE id=${id('recent')}`);
    await link('origin','isolated');
    const entityIds=['old','recent','manual','isolated'].map(id);
    const preview=await cleanupIntelligence({entityIds});
    expect(preview.entities.some(e=>e.id===id('old'))).toBe(true);
    expect(preview.review.some(e=>e.id===id('manual'))).toBe(true);
    await cleanupIntelligence({apply:true,entityIds});
    expect(await exists('intel_entities','old')).toBe(false);
    for (const name of ['manual','recent','isolated']) expect(await exists('intel_entities',name)).toBe(true);
  });

  it('preserves dossier and memory links, manual edges and merge survivors while removing derived debris', async () => {
    await seed(); await exclude(); await file('source'); await note('gone','source'); await note('kept',undefined,'web');
    for (const name of ['memory','dossier','manual-edge','target','doomed','alias']) { await entity(name,'gone'); await link('gone',name); }
    await db.execute(sql`INSERT INTO jkai_memories(id,category,content) VALUES(${id('memory-row')},'situations','Synthetic independent owner memory')`);
    await db.execute(sql`INSERT INTO jkai_memory_entities(memory_id,entity_id) VALUES(${id('memory-row')},${id('memory')})`);
    await db.execute(sql`INSERT INTO intel_dossiers(id,slug,title) VALUES(${id('dossier-row')},${id('dossier-row')},'Synthetic dossier')`);
    await db.execute(sql`INSERT INTO intel_dossier_items(dossier_id,kind,ref_id) VALUES(${id('dossier-row')},'entity',${id('dossier')})`);
    await db.execute(sql`INSERT INTO intel_relationships(source_entity_id,target_entity_id,type,source_note_id,manual) VALUES(${id('manual-edge')},${id('target')},'knows',${id('gone')},true)`);
    await db.execute(sql`UPDATE intel_entities SET merged_into_id=${id('doomed')} WHERE id=${id('alias')}`);
    await db.execute(sql`INSERT INTO intel_timeline_events(id,entity_id,note_id,date,type,title) VALUES(${id('event')},${id('doomed')},${id('kept')},'2026-01-01','event','Synthetic event')`);
    await db.execute(sql`INSERT INTO intel_insights(id,kind,title,explanation,dedupe_key,entity_ids) VALUES(${id('insight')},'orphan','Synthetic insight','Synthetic evidence',${id('insight')},${JSON.stringify([id('doomed')])}::jsonb)`);
    const r=await cleanupIntelligence({apply:true,pathPrefix:prefix});
    expect(r.counts.entitiesRemoved).toBe(2); expect(r.counts.entitiesProtected).toBe(4);
    expect(r.counts.timelineEventsRemoved).toBe(1); expect(r.counts.insightsRemoved).toBe(1);
    for(const name of ['memory','dossier','manual-edge','target'])expect(await exists('intel_entities',name)).toBe(true);
    expect((await db.execute(sql`SELECT * FROM jkai_memory_entities WHERE entity_id=${id('memory')}`)).rows).toHaveLength(1);
    expect((await db.execute(sql`SELECT source_note_id FROM intel_relationships WHERE source_entity_id=${id('manual-edge')}`)).rows).toEqual([{source_note_id:null}]);
  });

  it('continues bounded batches without forgetting later sources', async () => {
    await seed(); await exclude();
    await db.execute(sql`INSERT INTO workflow_files(id,name,mime_type,size_bytes,disk_path)
      SELECT ${prefix}||'-file-'||n,${prefix}||'/excluded/'||n||'.txt','text/plain',0,'/synthetic-no-bytes' FROM generate_series(1,251) n`);
    await db.execute(sql`INSERT INTO intel_notes(id,raw_content,source,metadata)
      SELECT ${prefix}||'-note-'||n,'Synthetic batch','file',jsonb_build_object('autoKind','file','refId',${prefix}||'-file-'||n) FROM generate_series(1,251) n`);
    const first=await cleanupIntelligence({apply:true,pathPrefix:prefix});
    expect(first.counts.notesRemoved).toBe(250); expect(first.counts.remaining).toBe(1);
    const second=await cleanupIntelligence({apply:true,pathPrefix:prefix});
    expect(second.counts.notesRemoved).toBe(1); expect(second.counts.remaining).toBe(0);
    expect((await cleanupIntelligence({pathPrefix:prefix})).counts.notesRemoved).toBe(0);
  });

  it('rechecks the current policy and owner protection when applying an earlier preview', async () => {
    await seed(); await exclude(); await file('source'); await note('gone','source'); await entity('unique','gone'); await link('gone','unique');
    expect((await cleanupIntelligence({pathPrefix:prefix})).counts.entitiesRemoved).toBe(1);
    await db.execute(sql`UPDATE drive_folder_settings SET intel_mode='include' WHERE path=${prefix+'/excluded'}`);
    expect((await cleanupIntelligence({apply:true,pathPrefix:prefix})).counts.notesRemoved).toBe(0);
    await db.execute(sql`UPDATE drive_folder_settings SET intel_mode='exclude' WHERE path=${prefix+'/excluded'}`);
    await db.execute(sql`UPDATE intel_entities SET confirmed=true WHERE id=${id('unique')}`);
    const result=await cleanupIntelligence({apply:true,pathPrefix:prefix});
    expect(result.counts.notesRemoved).toBe(1); expect(result.counts.entitiesRemoved).toBe(0);
    expect(await exists('intel_entities','unique')).toBe(true);
  });

  it('restores hidden entities whose merge target is gone without deleting unknown provenance', async () => {
    await seed(); await entity('broken');
    await db.execute(sql`UPDATE intel_entities SET merged_into_id=${id('missing-target')} WHERE id=${id('broken')}`);
    const preview=await cleanupIntelligence({entityIds:[id('broken')]});
    expect(preview.counts.brokenMergesRestored).toBe(1);
    await cleanupIntelligence({apply:true,entityIds:[id('broken')]});
    expect((await db.execute(sql`SELECT merged_into_id FROM intel_entities WHERE id=${id('broken')}`)).rows).toEqual([{merged_into_id:null}]);
  });

  it('checks admission atomically when exclusion changes after the initial policy read', async () => {
    await seed(); await file('queued','included');
    const policy = await import('./source-policy.server');
    const staleRead = vi.spyOn(policy,'policyForFileName').mockImplementationOnce(async () => {
      await exclude('included');
      return {included:true,categorySlugs:[]};
    });
    extract.mockClear();
    try {
      const { extractIntoIntel } = await import('./auto-extract');
      const result=await extractIntoIntel({kind:'file',refId:id('queued'),title:'Synthetic queued source',text:'Synthetic source content. '.repeat(20),contentHash:'admission-race'});
      expect(result.status).toBe('skipped'); expect(extract).not.toHaveBeenCalled();
      expect((await db.execute(sql`SELECT id FROM intel_notes WHERE metadata->>'refId'=${id('queued')}`)).rows).toHaveLength(0);
    } finally { staleRead.mockRestore(); }
  });

  it('refuses queued extraction after folder exclusion, even when the model was already running', async () => {
    await seed(); await file('queued','included');
    extract.mockImplementationOnce(async()=>{
      await exclude('included');
      return { entities:[],relationships:[],timelineEvents:[],proposedNewTypes:[],summary:'Synthetic result' };
    });
    const { extractIntoIntel } = await import('./auto-extract');
    const result=await extractIntoIntel({ kind:'file',refId:id('queued'),title:'Queued',text:'Synthetic source content. '.repeat(20),contentHash:'test-hash' });
    expect(result.status).toBe('skipped'); expect(extract).toHaveBeenCalled();
    expect((await db.execute(sql`SELECT id FROM intel_notes WHERE metadata->>'refId'=${id('queued')}`)).rows).toHaveLength(0);
  });

  it('rolls back the entire batch when a database deletion fails', async () => {
    await seed(); await exclude(); await file('source'); await note('gone','source'); await entity('unique','gone'); await link('gone','unique');
    const fn=`cleanup_test_${crypto.randomUUID().replaceAll('-','')}`;
    await db.execute(sql`CREATE FUNCTION ${sql.identifier(fn)}() RETURNS trigger LANGUAGE plpgsql AS ${sql.raw("$$ BEGIN IF OLD.id = '"+id('gone')+"' THEN RAISE EXCEPTION 'synthetic cleanup failure'; END IF; RETURN OLD; END $$")}`);
    await db.execute(sql`CREATE TRIGGER ${sql.identifier(fn)} BEFORE DELETE ON intel_notes FOR EACH ROW EXECUTE FUNCTION ${sql.identifier(fn)}()`);
    try {
      await expect(cleanupIntelligence({ apply:true,pathPrefix:prefix })).rejects.toThrow();
      expect(await exists('intel_notes','gone')).toBe(true); expect(await exists('intel_entities','unique')).toBe(true);
      expect((await db.execute(sql`SELECT * FROM intel_note_entities WHERE note_id=${id('gone')}`)).rows).toHaveLength(1);
    } finally {
      await db.execute(sql`DROP TRIGGER ${sql.identifier(fn)} ON intel_notes`);
      await db.execute(sql`DROP FUNCTION ${sql.identifier(fn)}()`);
    }
  });
});
