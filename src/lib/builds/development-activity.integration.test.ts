import { afterAll, beforeAll, expect, it } from 'vitest';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiLogs, jkaiIterations } from '$lib/db/schema';
import { inArray } from 'drizzle-orm';
import { developmentProgress } from './development-progress.server';
import { GET } from '../../routes/api/jkai/builds/[id]/logs/+server';
const local = process.env.JKAI_LOCAL_TESTS === '1' && /127\.0\.0\.1:15435\/jkai_local/.test(process.env.DATABASE_URL ?? '');
const ids = [crypto.randomUUID(), crypto.randomUUID()];
beforeAll(async () => { if (local) await db.insert(jkaiBuilds).values(ids.map(id => ({ id, prompt: 'Synthetic stream replay test', status: 'paused' }))); });
afterAll(async () => { if (local) await db.delete(jkaiBuilds).where(inArray(jkaiBuilds.id, ids)); });
async function get(after = '') { return GET({ params: { id: ids[0] }, url: new URL(`http://local/api/jkai/builds/${ids[0]}/logs${after ? '?after=' + after : ''}`) } as Parameters<typeof GET>[0]); }
it.skipIf(!local)('replays durable logs in order, isolates builds and recovers only missed rows', async () => {
 const rows = await db.insert(jkaiLogs).values([
  { buildId: ids[0], type: 'code', content: 'write page' }, { buildId: ids[1], type: 'error', content: 'Other build private log' },
  { buildId: ids[0], type: 'output', content: 'written' },
 ]).returning();
 const initial = await (await get()).json();
 expect(initial.logs.map((r: { content: string }) => r.content)).toEqual(['write page', 'written']);
 expect(initial.cursor).toBe(rows[2].id);
 const missed = await (await get(String(rows[0].id))).json();
 expect(missed.logs.map((r: { content: string }) => r.content)).toEqual(['written']);
 expect((await (await get(String(rows[2].id))).json()).logs).toEqual([]);
 expect((await get('-1')).status).toBe(400);
});

it.skipIf(!local)('sums all iteration usage while returning bounded build-isolated history', async () => {
 await db.insert(jkaiIterations).values([
  ...Array.from({length: 14}, (_, n) => ({buildId: ids[0], number: n+1, tokensUsed: 1000, outputTokens: 25, goals: 'x'.repeat(2500)})),
  {buildId: ids[1], number: 1, tokensUsed: 999999, outputTokens: 999999},
 ]);
 const progress = await developmentProgress(ids[0]);
 expect(progress.totalTokens).toBe(14000); expect(progress.outputTokens).toBe(350);
 expect(progress.iterations).toHaveLength(12); expect(progress.iterations[0].number).toBe(14);
 expect(progress.iterations[0].goals?.length).toBe(2000);
});
