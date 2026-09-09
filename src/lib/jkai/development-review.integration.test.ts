import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { ensureDelivery, loadDelivery, mutateDelivery } from './development-state.server';
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), accept: vi.fn(), create: vi.fn(), restart: vi.fn(), enqueue: vi.fn() }));
vi.mock('./development-workspace.server', () => ({ workspaceBroker: mocks.inspect, acceptDevelopment: mocks.accept }));
vi.mock('$lib/llm/client', () => ({ getLLMClient: async () => ({ model: 'fixture', client: { chat: { completions: { create: mocks.create } } } }) }));
// The adversary is its own workload role. Pinning it here to something other
// than the build's model is what makes `independent` true, which is the whole
// point of the stage — an unpinned role would follow the site default and could
// resolve to the model that wrote the code.
vi.mock('$lib/server/models/workload-settings', () => ({ resolveDevelopmentAssessorModel: async () => ({ provider: 'openrouter', modelId: 'reviewer/model' }) }));
vi.mock('./builder-client', () => ({ builderClient: { developmentCapabilities: async () => ({ persistentSessions: true, brokerConfigured: true }), restartBuild: mocks.restart } }));
vi.mock('./pending-messages', () => ({ enqueuePendingMessage: mocks.enqueue, instructionHistory: async () => [] }));
import { reviewDevelopmentCriteria, continueDevelopment } from './development-review.server';
const local = process.env.JKAI_LOCAL_TESTS === '1' && /127\.0\.0\.1:15435\/jkai_local/.test(process.env.DATABASE_URL ?? '');
describe.skipIf(!local)('default review in isolated Postgres', () => {
  const ids: string[] = []; let id: string; const candidate = 'a'.repeat(40);
  beforeEach(async () => {
    vi.clearAllMocks(); id = crypto.randomUUID(); ids.push(id);
    await db.insert(jkaiBuilds).values({ id, prompt: 'Synthetic review', status: 'paused', modelId: 'codex/gpt-5.6-terra', modelProvider: 'codex' });
    await ensureDelivery(id, 'Platform', ['Save a stop']);
    await mutateDelivery(id, 'fixture', s => ({ ...s, candidate, stage: 'review', session: { ...s.session, id: 'fixture' }, brief: { ...s.brief, acceptedAt: 'today' }, gate: { passed: true, revision: candidate, evidence: 'Gates passed' }, preview: { url: 'https://preview.test', status: 'ready', revision: candidate, kind: 'working', detail: '' } }));
    mocks.inspect.mockResolvedValue({ revision: candidate, evidence: ['390px: clicked Save; observed Saved stop'], changes: { files: ['page.svelte'], patch: '+ saveStop()' } });
    // Two calls per all-pass round now: the criteria assessment, then the veto.
    mocks.create
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ criteria: [{ id: 'criterion-1', verdict: 'passed', basis: 'inferred', evidence: 'The inspected handler saves the stop; the browser showed Saved stop.' }] }) } }] })
      .mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ veto: false, reason: '', evidence: '' }) } }] });
  });
  afterAll(async () => { for (const id of ids) await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, id)); });
  it('assesses blank criteria from fresh inspection and integrates when the gate passed', async () => {
    const state = (await loadDelivery(id))!;
    expect(await continueDevelopment(id, state.revision)).toBe('accepted');
    expect(mocks.inspect).toHaveBeenCalledWith('inspect', id, { revision: candidate });
    expect(mocks.accept).toHaveBeenCalledWith(id, state.revision + 1);
    // Assessment first, veto second — an all-pass round is the one place a false
    // pass is expensive, so it gets a second, differently-framed look.
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.create.mock.calls[1][0])).toContain('should NOT be released');
    const c = (await loadDelivery(id))!.state.criteria[0];
    expect(c.verdict).toBe('unverified');
    expect(c.assessment).toMatchObject({ verdict: 'passed', revision: candidate, model: 'fixture', basis: 'inferred', independent: true });
    expect(JSON.stringify(mocks.create.mock.calls[0][0])).toContain('observed Saved stop');
  });
  it('preserves owner failure and resumes targeted work instead of accepting', async () => {
    const state = await mutateDelivery(id, 'owner', s => ({ ...s, criteria: s.criteria.map(c => ({ ...c, verdict: 'failed', revision: candidate, evidence: 'The wrong stop was saved.' })) }));
    expect(await continueDevelopment(id, state.revision)).toBe('building');
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.enqueue.mock.calls[0][1]).toContain('The wrong stop was saved.');
    expect(mocks.restart).toHaveBeenCalledWith(id);
  });
  it('continues to repository verification even when the model thinks every criterion passes', async () => {
    const state = await mutateDelivery(id, 'fixture', s => ({ ...s, gate: null }));
    expect(await continueDevelopment(id, state.revision)).toBe('building');
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.enqueue.mock.calls[0][1]).toContain('complete:true');
  });
  it('cannot overwrite owner feedback saved during model review', async () => {
    const state = (await loadDelivery(id))!;
    mocks.create.mockImplementationOnce(async () => {
      await mutateDelivery(id, 'owner', s => ({ ...s, criteria: s.criteria.map(c => ({ ...c, verdict: 'failed', revision: candidate, evidence: 'Owner observed failure' })) }));
      return { choices: [{ message: { content: JSON.stringify({ criteria: [{ id: 'criterion-1', verdict: 'passed', basis: 'inferred', evidence: 'Model opinion' }] }) } }] };
    });
    await expect(reviewDevelopmentCriteria(id, state.revision)).rejects.toThrow('changed');
    expect((await loadDelivery(id))!.state.criteria[0]).toMatchObject({ verdict: 'failed', evidence: 'Owner observed failure' });
    expect((await loadDelivery(id))!.state.criteria[0].assessment).toBeUndefined();
  });
});
