import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureDelivery, loadDelivery, mutateDelivery } from '$lib/jkai/development-state.server';
const model = vi.hoisted(() => ({ groom: vi.fn() }));
vi.mock('$lib/jkai/development-grooming.server', async importOriginal => ({ ...await importOriginal<typeof import('$lib/jkai/development-grooming.server')>(), groomDevelopmentBrief: model.groom }));
import { POST } from '../../routes/api/jkai/development/[id]/+server';
const local = process.env.JKAI_LOCAL_TESTS === '1' && /127\.0\.0\.1:15435\/jkai_local/.test(process.env.DATABASE_URL ?? '');
const id = crypto.randomUUID();
const proposal = { brief: { outcome: 'Refined outcome', constraints: '', routes: ['/health'], dependencies: 'Verify measurements', scope: 'Weekly comparison', assumptions: '', questions: 'Which metrics?', validation: 'Reload comparison' }, criteria: ['Comparison survives reload'], grooming: { model: 'fixture', at: new Date().toISOString(), summary: 'Choose metrics' } };
beforeAll(async () => { if (local) { await db.insert(jkaiBuilds).values({ id, prompt: 'Original high level ask', status: 'paused' }); await ensureDelivery(id, 'Health'); } });
afterAll(async () => { if (local) await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, id)); });
async function post(fields: Record<string, unknown>) {
 const row = (await loadDelivery(id))!;
 return POST({ params: { id }, request: new Request('http://localhost/api/jkai/development/' + id, { method: 'POST', body: JSON.stringify({ action: 'groom', area: 'Health', revision: row.revision, briefRevision: row.state.brief.revision, outcome: row.state.brief.outcome, ...fields }) }) } as Parameters<typeof POST>[0]);
}
it.skipIf(!local)('persists proposals, retains the original ask, allows explicit acceptance with retained questions and loses no edits on failure or races', async () => {
 model.groom.mockResolvedValue(proposal);
 expect((await post({})).status).toBe(200);
 let row = (await loadDelivery(id))!;
 expect(row.state.criteria[0].text).toBe('Comparison survives reload');
 expect(row.state.brief.acceptedAt).toBeNull();
 expect(row.state.brief.dependencies).toBe('Verify measurements');
 const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, id));
 expect(build.prompt).toBe('Original high level ask');
 for (const answer of ['Steps only', 'Owner only', 'Use weekly totals', 'Use sensible defaults']) {
   expect((await post({ message: answer, questions: 'Which metrics?' })).status).toBe(200);
 }
 expect(model.groom.mock.calls.at(-1)![3]).toHaveLength(3);
 expect((await loadDelivery(id))!.state.grooming?.turns?.map(t => t.answer)).toEqual(['Steps only', 'Owner only', 'Use weekly totals', 'Use sensible defaults']);
 row = (await loadDelivery(id))!;
 model.groom.mockRejectedValue(new Error('Provider unavailable'));
 expect((await post({})).status).toBe(400);
 expect((await loadDelivery(id))!.revision).toBe(row.revision);
 model.groom.mockImplementation(async () => {
   await mutateDelivery(id, 'owner_edit', s => ({ ...s, brief: { ...s.brief, outcome: 'Concurrent owner edit' } }));
   return proposal;
 });
 expect((await post({})).status).toBe(400);
 expect((await loadDelivery(id))!.state.brief.outcome).toBe('Concurrent owner edit');
 row = (await loadDelivery(id))!;
 const calls = model.groom.mock.calls.length;
 expect((await post({ action: 'brief', outcome: 'Ready to build', constraints: 'Owner only', criteria: 'A saved comparison survives reload', routes: '/health', questions: 'Which layout works best?' })).status).toBe(200);
 const accepted = (await loadDelivery(id))!;
 expect(accepted.state.brief.acceptedAt).not.toBeNull();
 expect(accepted.state.brief.questions).toBe('Which layout works best?');
 expect((await post({})).status).toBe(400);
 expect(model.groom.mock.calls.length).toBe(calls);
});
