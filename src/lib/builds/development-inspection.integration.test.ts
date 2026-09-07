import { afterAll, beforeAll, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ broker: vi.fn(), preview: vi.fn() }));
vi.mock('$lib/jkai/development-workspace.server', () => ({ workspaceBroker: mocks.broker, prepareDevelopmentPreview: mocks.preview, acceptDevelopment: vi.fn() }));
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureDelivery, loadDelivery, mutateDelivery } from '$lib/jkai/development-state.server';
import { acceptanceBlocker } from '$lib/jkai/development';
import { POST } from '../../routes/api/jkai/development/[id]/+server';
const local = process.env.JKAI_LOCAL_TESTS === '1' && /127\.0\.0\.1:15435\/jkai_local/.test(process.env.DATABASE_URL ?? '');
const id = crypto.randomUUID();
beforeAll(async () => {
 if (!local) return;
 await db.insert(jkaiBuilds).values({ id, prompt: 'Synthetic inspection contract', status: 'paused' });
 await ensureDelivery(id, 'Platform');
 await mutateDelivery(id, 'test_brief', s => ({...s, brief:{...s.brief, acceptedAt:new Date().toISOString()}, criteria:[{id:'c',text:'It works',verdict:'unverified',evidence:'',revision:null}]}));
 await db.insert(jkaiIterations).values({buildId:id,number:1,status:'completed',tokensUsed:100,outputTokens:10});
 mocks.broker.mockResolvedValue({revision:'a'.repeat(40),changes:{files:['src/routes/example/+page.svelte'],patch:'+example'}});
 mocks.preview.mockImplementation(async () => { await mutateDelivery(id, 'preview_ready', s => ({...s, preview:{url:'http://127.0.0.1:5281',status:'ready',detail:'Synthetic preview'}})); });
});
afterAll(async () => { if (local) await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id,id)); });
async function request(action='inspect_preview', revision?: number) {
 const delivery=await loadDelivery(id);
 return POST({params:{id},request:new Request('http://local/api/jkai/development/'+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,revision:revision ?? delivery!.revision})})} as Parameters<typeof POST>[0]);
}
it.skipIf(!local)('rejects active work and stale requests before snapshotting', async () => {
 await db.update(jkaiBuilds).set({status:'running'}).where(eq(jkaiBuilds.id,id));
 expect((await request()).status).toBe(400); expect(mocks.broker).not.toHaveBeenCalled();
 await db.update(jkaiBuilds).set({status:'paused'}).where(eq(jkaiBuilds.id,id));
 expect((await request('inspect_preview',-1)).status).toBe(409); expect(mocks.broker).not.toHaveBeenCalled();
});
it.skipIf(!local)('prepares an inspection snapshot while keeping acceptance blocked', async () => {
 expect((await request()).status).toBe(200);
 const delivery=(await loadDelivery(id))!;
 expect(mocks.broker).toHaveBeenCalledWith('snapshot',id);
 expect(delivery.state.preview.status).toBe('ready'); expect(delivery.state.gate?.passed).toBe(false);
 expect(delivery.state.candidate).toBe('a'.repeat(40)); expect(delivery.state.acceptedAt).toBeNull();
 expect(acceptanceBlocker(delivery.state)).toContain('passing repository gate');
 const [build]=await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id,id)); expect(build.status).toBe('paused');
});
it.skipIf(!local)('records snapshot failure and releases the preparing state', async () => {
 mocks.broker.mockRejectedValueOnce(new Error('Synthetic broker unavailable'));
 expect((await request()).status).toBe(400);
 const delivery=(await loadDelivery(id))!;
 expect(delivery.state.preview.status).toBe('failed'); expect(delivery.state.preview.detail).toContain('Synthetic broker unavailable');
 expect(delivery.state.gate?.passed).toBe(false);
});
