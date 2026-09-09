import { beforeEach, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { syntheticCandidate, syntheticSource } from '$lib/policy-incentives-lab/synthetic';
const fixture = vi.hoisted(() => ({ getProject: vi.fn(), loadVersion: vi.fn(), saveRun: vi.fn(), saveDraft: vi.fn() }));
vi.mock('$lib/policy-incentives-lab/server/access', () => ({ requireLabOwner: async () => 'owner@example.test' }));
vi.mock('$lib/policy-incentives-lab/server/provider', () => ({ proposalTransport: () => null }));
vi.mock('$lib/policy-incentives-lab/server/store', () => ({ ...fixture, hash: () => 'test-hash' }));
vi.mock('$lib/file-store/storage', () => ({ newDiskPath: vi.fn(), saveBuffer: vi.fn() }));
import { POST } from '../../../src/routes/api/policy-incentives-lab/[...path]/+server';
const id = 'b9a266bb-b3e0-4071-9bd0-a7dc882b5c00';
function event(resource: string, body: unknown, origin = 'http://localhost:5275') {
  const url = new URL(`http://localhost:5275/api/policy-incentives-lab/projects/${id}/${resource}`);
  return { params: { path: `projects/${id}/${resource}` }, url, locals: {}, setHeaders: vi.fn(), request: new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }) } as unknown as RequestEvent;
}
beforeEach(() => {
  vi.clearAllMocks();
  const payload = { source: syntheticSource, candidate: syntheticCandidate(), attempts: [], activity: [], hypotheses: [] };
  fixture.getProject.mockResolvedValue({ id, revision: 0, payload });
  fixture.loadVersion.mockResolvedValue({ id, version: 1, modelHash: 'x', payload });
});
it('blocks direct API simulation with an unapproved saved model', async () => {
  const response = await POST(event('runs', { revision: 0, version_id: id, config: { simulation_type: 'normal-form', seed: 1, rounds: 1, scenario: 'baseline', parameters: {} } }));
  expect(response.status).toBe(400); expect((await response.json()).error).toContain('Approval required'); expect(fixture.saveRun).not.toHaveBeenCalled();
});
it('refuses stale revision and cross-origin writes', async () => {
  await expect(POST(event('approvals', { revision: 1, item_ids: ['amber'] }))).rejects.toMatchObject({ status: 409 });
  await expect(POST(event('approvals', { revision: 0, item_ids: ['amber'] }, 'https://untrusted.example'))).rejects.toMatchObject({ status: 403 });
});
it('ignores forged model approval fields on model edits', async () => {
  const candidate = syntheticCandidate(); candidate.game.actors[0].approval_status = { status: 'approved', approved_by: 'forged', approved_at: 'today' };
  fixture.saveDraft.mockResolvedValue({});
  expect((await POST(event('model', { revision: 0, candidate }))).status).toBe(200);
  const payload = fixture.saveDraft.mock.calls[0][3];
  expect(payload.candidate.game.actors[0].approval_status.status).toBe('pending');
});
