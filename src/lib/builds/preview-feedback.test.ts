import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { ensureDelivery, loadDelivery, mutateDelivery } from '$lib/jkai/development-state.server';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), broker: vi.fn() }));
vi.mock('$lib/jkai/development-workspace.server', () => ({ prepareDevelopmentPreview: mocks.preview, workspaceBroker: mocks.broker, acceptDevelopment: vi.fn() }));
import { POST } from '../../routes/api/jkai/development/[id]/+server';

const local = process.env.JKAI_LOCAL_TESTS === '1' && /127\.0\.0\.1:15445\/workflows_jkai_local/.test(process.env.DATABASE_URL ?? '');
// Keep this in the merge gate: its database is isolated and provisioned by CI.
const ci = process.env.CI === 'true' && process.env.DATABASE_URL === 'postgresql://app:test@localhost:5432/strange_rambling';
describe.skipIf(!local && !ci)('feedback while a replacement preview is prepared', () => {
  const id = crypto.randomUUID();
  const old = 'a'.repeat(40), next = 'b'.repeat(40);
  beforeAll(async () => {
    await db.insert(jkaiBuilds).values({ id, prompt: 'Synthetic preview feedback regression', status: 'paused' });
    await ensureDelivery(id, 'Platform', ['Generate a result']);
    await mutateDelivery(id, 'fixture', s => ({ ...s, candidate: next, brief: { ...s.brief, acceptedAt: new Date().toISOString() }, preview: { url: 'https://synthetic.invalid/', revision: old, status: 'starting', detail: 'Preparing next revision' } }));
  });
  afterAll(async () => { await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, id)); });
  async function request(action: string, fields = {}) {
    const delivery = (await loadDelivery(id))!;
    return POST({ params: { id }, request: new Request('http://local/api/jkai/development/' + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, revision: delivery.revision, ...fields }) }) } as Parameters<typeof POST>[0]);
  }
  it('saves an observation about the retained preview despite a moving workspace revision', async () => {
    const result = await request('criterion', { revision: -1, criterionId: 'criterion-1', judgedRevision: old, verdict: 'failed', evidence: 'Generate did not change the displayed result.' });
    expect(result.status).toBe(200);
    const delivery = (await loadDelivery(id))!;
    expect(delivery.state.criteria[0]).toMatchObject({ revision: old, verdict: 'failed', evidence: 'Generate did not change the displayed result.' });
    expect(delivery.state.preview.status).toBe('starting');
    expect(delivery.state.candidate).toBe(next);
  });
  it('rejects evidence about a revision that is no longer available', async () => {
    const result = await request('criterion', { criterionId: 'criterion-1', judgedRevision: 'c'.repeat(40), verdict: 'passed', evidence: 'An unrelated version' });
    expect(result.status).toBe(400);
    expect((await loadDelivery(id))!.state.criteria[0].verdict).toBe('failed');
  });
  it('refuses duplicate preparation without calling the broker', async () => {
    expect((await request('preview')).status).toBe(400);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.broker).not.toHaveBeenCalled();
  });
  it('allows retry once preparation has failed', async () => {
    await mutateDelivery(id, 'fixture', s => ({ ...s, preview: { ...s.preview, status: 'failed', lastError: 'Synthetic provisioning failure' } }));
    expect((await request('preview')).status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith(id);
  });
});
