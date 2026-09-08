import { beforeEach, expect, it, vi } from 'vitest';
import { newDelivery, candidateChanged, acceptanceBlocker, deliveryPrompt } from '$lib/jkai/development';
import type { DeliveryState } from '$lib/constants/development';
const fixture = vi.hoisted(() => ({ state: null as unknown as DeliveryState, calls: [] as string[] }));
vi.mock('$lib/jkai/development-state.server', () => ({
  loadDelivery: async () => ({ state: fixture.state, revision: 1 }),
  mutateDelivery: async (_id: string, _kind: string, mutate: (state: DeliveryState) => DeliveryState) => { fixture.state = mutate(fixture.state); },
}));
import { developmentCheckpoint, prepareDevelopmentPreview } from '$lib/jkai/development-workspace.server';
const old = 'a'.repeat(40), next = 'b'.repeat(40);
beforeEach(() => {
  fixture.state = newDelivery('Save a preference', 'Platform', ['Survives reload']);
  fixture.state.brief.acceptedAt = 'today'; fixture.state.brief.routes = ['/example'];
  fixture.state.candidate = old;
  fixture.state.preview = { revision: old, kind: 'working', number: 1, url: 'http://preview/old', status: 'ready', detail: 'Working' };
  fixture.calls = [];
  vi.stubEnv('BUILDER_WORKSPACE_BROKER_URL', 'http://broker'); vi.stubEnv('BUILDER_WORKSPACE_BROKER_TOKEN', 'fixture');
});
function broker(complete = false, fail = '') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const action = new URL(url).pathname.slice(1); fixture.calls.push(action);
    if (action === 'snapshot') return Response.json({ revision: next, changes: { files: ['example'], patch: '+ example' } });
    expect(fixture.state.preview.url).toBe(action === 'verify' ? 'http://preview/new' : 'http://preview/old');
    expect(fixture.state.preview.status).toBe('starting');
    if (action === fail) return Response.json({ error: 'Synthetic feature check failed' }, { status: 400 });
    return Response.json({ revision: next, url: 'http://preview/new', complete, evidence: ['390px: Save → Saved'] });
  }));
}
it('preserves a previous snapshot but rejects its evidence for a newer candidate', () => {
  fixture.state.gate = { revision: old, passed: true, evidence: 'Passed' };
  const state = candidateChanged(fixture.state, next);
  expect(state.preview.url).toBe('http://preview/old'); expect(state.preview.revision).toBe(old);
  state.gate = { revision: next, passed: true, evidence: 'Passed' };
  expect(acceptanceBlocker(state)).toMatch(/preview/);
  expect(deliveryPrompt(state)).toContain('FIRST MILESTONE');
});
it('publishes the first useful slice without invoking release verification', async () => {
  broker(); const verify = vi.fn(run => run());
  expect(await developmentCheckpoint('fixture', verify)).toBe(false);
  expect(verify).not.toHaveBeenCalled(); expect(fixture.calls).toEqual(['snapshot', 'preview']);
  expect(fixture.state.preview).toMatchObject({ revision: next, kind: 'working', number: 2 });
  expect(fixture.state.stage).toBe('building'); expect(fixture.state.gate).toBeNull();
});
it('keeps the last working preview when a replacement fails', async () => {
  broker(false, 'preview');
  await expect(developmentCheckpoint('fixture', run => run())).rejects.toThrow('Synthetic');
  expect(fixture.state.preview).toMatchObject({ revision: old, url: 'http://preview/old', status: 'ready', number: 1 });
  expect(fixture.state.preview.lastError).toContain('Synthetic'); expect(fixture.state.gate).toBeNull();
});
it('requires isolated verification before marking a release candidate', async () => {
  broker(true);
  expect(await developmentCheckpoint('fixture', run => run())).toBe(true);
  expect(fixture.calls).toEqual(['snapshot', 'preview', 'verify']);
  expect(fixture.state.preview).toMatchObject({ revision: next, kind: 'release', number: 2 });
  expect(fixture.state.gate).toMatchObject({ revision: next, passed: true });
});
it('retains a working preview and blocks acceptance when full verification fails', async () => {
  broker(true, 'verify');
  await expect(developmentCheckpoint('fixture', run => run())).rejects.toThrow('Synthetic');
  expect(fixture.state.preview).toMatchObject({ revision: next, kind: 'working', status: 'ready' });
  expect(acceptanceBlocker(fixture.state)).toMatch(/gate/);
});
it('rejects a changed candidate while preview preparation is in flight', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { fixture.state = candidateChanged(fixture.state, next); return Response.json({ url: 'http://preview/stale' }); }));
  await expect(prepareDevelopmentPreview('fixture', 'working')).rejects.toThrow('candidate changed');
  expect(fixture.state.preview.url).toBe('http://preview/old');
});

it('does not claim a release candidate if the owner pauses during verification', async () => {
  broker(true);
  await expect(developmentCheckpoint('fixture', async run => { await run(); throw new Error('Build paused'); })).rejects.toThrow('Build paused');
  expect(fixture.state.preview.kind).toBe('working'); expect(fixture.state.gate).toBeNull();
});
