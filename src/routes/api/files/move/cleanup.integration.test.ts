import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { POST } from './+server';

vi.mock('$lib/jkai/intel/analytics/load', () => ({ invalidateGraphAnalysis: vi.fn() }));
vi.mock('$lib/jkai/intel/resolve/merge', () => ({ invalidateResolutionCaches: vi.fn() }));
const enabled = process.env.JKAI_LOCAL_TESTS === '1' && /(?:127\.0\.0\.1:15435|jkai-db:5432)\/jkai_local/.test(process.env.DATABASE_URL ?? '');
let prefix = '';
const id = (name: string) => `${prefix}-${name}`;
async function seed() {
  prefix = `cleanup-move-${crypto.randomUUID()}`;
  await db.execute(sql`INSERT INTO intel_entity_types(id,name) VALUES(${prefix},${prefix})`);
  await db.execute(sql`INSERT INTO drive_folder_settings(path,intel_mode) VALUES(${prefix+'/excluded'},'exclude')`);
  for (const name of ['one', 'two']) {
    await db.execute(sql`INSERT INTO workflow_files(id,name,mime_type,size_bytes,disk_path) VALUES(${id(name)},${prefix+'/included/'+name},'text/plain',0,'/synthetic-no-bytes')`);
    await db.execute(sql`INSERT INTO intel_notes(id,raw_content,source,metadata) VALUES(${id(name)},'Synthetic batch-move evidence','file',${JSON.stringify({autoKind:'file',refId:id(name)})}::jsonb)`);
    await db.execute(sql`INSERT INTO intel_entities(id,name,type_id,first_seen_in) VALUES(${id(name)},${name},${prefix},${id(name)})`);
    await db.execute(sql`INSERT INTO intel_note_entities(note_id,entity_id) VALUES(${id(name)},${id(name)})`);
  }
}
async function move(moves: Array<{id:string;name:string}>) {
  return POST({request:new Request('http://localhost/api/files/move',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({moves})})} as Parameters<typeof POST>[0]);
}
describe.skipIf(!enabled)('batch move source cleanup', () => {
  afterEach(async () => {
    if (!prefix) return;
    await db.execute(sql`DELETE FROM intel_entities WHERE type_id=${prefix}`);
    await db.execute(sql`DELETE FROM intel_notes WHERE id LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM workflow_files WHERE id LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM drive_folder_settings WHERE path LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM intel_entity_types WHERE id=${prefix}`);
    prefix='';
  });
  it('cleans only the files moved into excluded folders', async () => {
    await seed();
    const response=await move([{id:id('one'),name:prefix+'/excluded/one'},{id:id('two'),name:prefix+'/included/renamed'}]);
    expect(response.status).toBe(200);
    expect((await db.execute(sql`SELECT id FROM intel_notes WHERE id=${id('one')}`)).rows).toHaveLength(0);
    expect((await db.execute(sql`SELECT id FROM intel_entities WHERE id=${id('one')}`)).rows).toHaveLength(0);
    expect((await db.execute(sql`SELECT id FROM intel_notes WHERE id=${id('two')}`)).rows).toHaveLength(1);
  });
  it('does not remove intelligence when a move is rejected', async () => {
    await seed();
    const response=await move([{id:id('one'),name:prefix+'/included/two'}]);
    expect(response.status).toBe(409);
    expect((await db.execute(sql`SELECT id FROM intel_notes WHERE id=${id('one')}`)).rows).toHaveLength(1);
  });
});
