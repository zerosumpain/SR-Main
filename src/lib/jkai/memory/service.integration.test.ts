import { afterAll, it, expect, vi } from 'vitest';
vi.mock('$lib/jkai/intel/embed', () => ({ generateEmbedding: async () => { throw new Error('offline fixture'); } }));
import { db } from '$lib/db';
import { jkaiMemories } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { writeMemory, forgetMemory } from './service.server';
const ids: string[] = [];
const source = `memory-test-${crypto.randomUUID()}`;
const write = async (content: string, extra: Record<string, any> = {}) => {
  const row = await writeMemory({ category: 'people', content, provenance: { origin: 'user', sourceId: source, assertion: 'stated' }, ...extra });
  ids.push(row.id); return row;
};
afterAll(async () => { if (ids.length) await db.delete(jkaiMemories).where(inArray(jkaiMemories.id, ids)); });
it('keeps distinct subjects and only replaces an explicit current ID', async () => {
  const john = await write('John likes cycling in London');
  const mary = await write('Mary likes cycling in London');
  const short = await write('yes');
  const rows = await db.select().from(jkaiMemories).where(inArray(jkaiMemories.id, [john.id, mary.id, short.id]));
  expect(rows.every(r => r.supersededBy === null)).toBe(true);
  const update = await write('John now cycles in York', { replacesId: john.id });
  const [old] = await db.select().from(jkaiMemories).where(eq(jkaiMemories.id, john.id));
  expect(old.supersededBy).toBe(update.id);
});
it('rolls back both insertion and replacement when the transaction fails', async () => {
  const original = await write('Original transactional fact');
  await expect(db.transaction(async tx => {
    await writeMemory({ category: 'people', content: 'Must roll back', replacesId: original.id, provenance: { origin: 'user', sourceId: source } }, tx);
    throw new Error('rollback fixture');
  })).rejects.toThrow('rollback fixture');
  const [row] = await db.select().from(jkaiMemories).where(eq(jkaiMemories.id, original.id));
  expect(row.supersededBy).toBeNull();
});
it('forgets derived Daydream rulings and suppresses re-extraction of the same source', async () => {
  const fact = await write('A user preference for quiet routes');
  const finding = await write('Daydream suggests a quiet route', { daydreamOrigin: 'ruling', provenance: { origin: 'daydream-ruling', sourceId: source + '-thought', sourceMemoryIds: [fact.id], assertion: 'inferred' } });
  expect(finding.confidence).toBe('medium');
  await forgetMemory(fact.id);
  const [row] = await db.select().from(jkaiMemories).where(eq(jkaiMemories.id, finding.id));
  expect(row.supersededBy).toBe('forgotten');
  const replay = await write('Daydream suggests a quiet route', { daydreamOrigin: 'ruling', provenance: { origin: 'daydream-ruling', sourceId: source + '-thought', sourceMemoryIds: [fact.id], assertion: 'inferred' } });
  expect(replay.suppressed).toBe(true);
  await expect(write('A paraphrased recycled conclusion', { provenance: { origin: 'daydream-ruling', sourceId: source + '-new-thought', sourceMemoryIds: [fact.id], assertion: 'inferred' } })).rejects.toThrow('forgotten');
});
