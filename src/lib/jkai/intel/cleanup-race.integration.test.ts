import { afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { cleanupIntelligence } from './cleanup.server';
import { embedEntity } from './embed';

const provider = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('$lib/llm/client', () => ({ getLLMClient: async () => ({ client: { embeddings: provider }, model: 'synthetic' }) }));
vi.mock('./analytics/load', () => ({ invalidateGraphAnalysis: vi.fn() }));
vi.mock('./resolve/merge', () => ({ invalidateResolutionCaches: vi.fn() }));
const enabled = process.env.JKAI_LOCAL_TESTS === '1' && /(?:127\.0\.0\.1:15435|jkai-db:5432)\/jkai_local/.test(process.env.DATABASE_URL ?? '');
const prefix = `cleanup-race-${crypto.randomUUID()}`;

describe.skipIf(!enabled)('cleanup versus delayed embeddings', () => {
  afterAll(async () => {
    await db.execute(sql`DELETE FROM intel_entities WHERE type_id=${prefix}`);
    await db.execute(sql`DELETE FROM intel_notes WHERE id LIKE ${prefix+'%'}`);
    await db.execute(sql`DELETE FROM intel_entity_types WHERE id=${prefix}`);
  });
  it('discards an old vector when source cleanup changed the entity during the provider call', async () => {
    await db.execute(sql`INSERT INTO intel_entity_types(id,name) VALUES(${prefix},${prefix})`);
    await db.execute(sql`INSERT INTO intel_notes(id,raw_content,graph_state) VALUES(${prefix+'-gone'},'Excluded source','admitted'),(${prefix+'-keep'},'Surviving source','admitted')`);
    await db.execute(sql`INSERT INTO intel_entities(id,name,type_id,summary) VALUES(${prefix},'Synthetic shared entity',${prefix},'Excluded fact')`);
    await db.execute(sql`INSERT INTO intel_note_entities(note_id,entity_id,excerpt) VALUES(${prefix+'-gone'},${prefix},'Excluded fact'),(${prefix+'-keep'},${prefix},'Surviving fact')`);
    let start!: () => void;
    let finish!: (value: unknown) => void;
    const entered = new Promise<void>(resolve => { start = resolve; });
    const response = new Promise(resolve => { finish = resolve; });
    provider.create.mockImplementationOnce(() => { start(); return response; });
    const pending = embedEntity(prefix);
    await entered;
    try {
      await cleanupIntelligence({ apply: true, noteIds: [prefix+'-gone'], scanOrphans: false });
    } finally {
      finish({ data: [{ index: 0, embedding: new Array(1536).fill(.1) }] });
      await pending;
    }
    const entity = (await db.execute(sql`SELECT summary,embedding FROM intel_entities WHERE id=${prefix}`)).rows[0];
    expect(entity).toEqual({ summary: 'Surviving fact', embedding: null });
    // Exact timestamp version matching must still allow a current vector write.
    provider.create.mockResolvedValueOnce({ data: [{ index: 0, embedding: new Array(1536).fill(.2) }] });
    await embedEntity(prefix);
    expect((await db.execute(sql`SELECT embedding IS NOT NULL AS embedded FROM intel_entities WHERE id=${prefix}`)).rows[0].embedded).toBe(true);
  });
});
