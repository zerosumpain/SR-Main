import { beforeEach, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { syntheticCandidate, syntheticSource } from '$lib/policy-incentives-lab/synthetic';
const fixture = vi.hoisted(() => ({ getProject: vi.fn(), loadVersion: vi.fn(), saveRun: vi.fn(), saveDraft: vi.fn(), loadLibraryContent: vi.fn() }));
vi.mock('$lib/policy-incentives-lab/server/library', () => ({ loadLibraryContent: fixture.loadLibraryContent, searchLibrary: vi.fn() }));
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
it('saves a first look on source load without silently creating or approving a model', async () => {
  fixture.saveDraft.mockResolvedValue({});
  expect((await POST(event('sources', { revision: 0, synthetic: true }))).status).toBe(200);
  const payload = fixture.saveDraft.mock.calls[0][3];
  expect(payload.first_look.status).toBe('unreviewed'); expect(payload.first_look.source_hash).toBe('test-hash');
  expect(payload.candidate).toBeNull(); expect(fixture.saveRun).not.toHaveBeenCalled();
});
it('refreshes the first look without changing existing model approvals', async () => {
  fixture.saveDraft.mockResolvedValue({});
  await POST(event('first-look', { revision: 0 }));
  const payload = fixture.saveDraft.mock.calls[0][3];
  expect(payload.candidate).toEqual(syntheticCandidate()); expect(payload.first_look.status).toBe('unreviewed');
});
it('auto-resolve previews do not approve, and acceptance requires the displayed item list and explicit consent', async () => {
  fixture.saveDraft.mockImplementation(async (_owner, _id, revision, payload) => ({ revision: revision + 1, payload }));
  const prepared = await POST(event('auto-resolve', { revision: 0, options: { seed: 9, low: 0, high: 10 } }));
  expect(prepared.status).toBe(200);
  const { payload } = await prepared.json();
  expect(payload.candidate.game.actors[0].approval_status.status).toBe('pending');
  expect(fixture.saveRun).not.toHaveBeenCalled();
  fixture.getProject.mockResolvedValue({ id, revision: 0, payload });
  expect((await POST(event('accept-auto-resolve', { revision: 0, proposal_hash: 'test-hash', item_ids: [] }))).status).toBe(400);
  expect((await POST(event('accept-auto-resolve', { revision: 0, proposal_hash: 'test-hash', item_ids: [], accept_illustrative: true }))).status).toBe(400);
  const { reviewItems } = await import('$lib/policy-incentives-lab/validation');
  const ids = reviewItems(payload.auto_resolution.proposal.candidate.game).map(i => i.id);
  const accepted = await POST(event('accept-auto-resolve', { revision: 0, proposal_hash: 'test-hash', item_ids: ids, accept_illustrative: true }));
  expect(accepted.status).toBe(200);
  const result = await accepted.json(); expect(result.payload.illustrative_setup.accepted_by).toBe('owner@example.test');
  expect(reviewItems(result.payload.candidate.game).every(i => i.approval_status.approved_by === 'owner@example.test')).toBe(true);
});

it('imports full selected publication text and metadata into the private source and prepares a first look', async () => {
  fixture.loadLibraryContent.mockResolvedValue({ path: '/government/publications/synthetic', title: 'SYNTHETIC publication', publisher: 'Fictional publisher', publication_date: '2026-01-01', source_url: 'https://www.gov.uk/government/publications/synthetic', sections: syntheticSource.text_sections, documents: [{ title: 'SYNTHETIC rules' }], selected: 0, warnings: [], retrieved_at: '2026-01-01T00:00:00Z' });
  fixture.saveDraft.mockImplementation(async (_o, _id, revision, payload) => ({ revision: revision + 1, payload }));
  const response = await POST(event('govuk-source', { revision: 0, path: '/government/publications/synthetic', document: 0 }));
  expect(response.status).toBe(200);
  const { payload } = await response.json();
  expect(payload.source.text_sections).toEqual(syntheticSource.text_sections); expect(payload.source.title).toBe('SYNTHETIC publication');
  expect(payload.govuk_import.documents[0].title).toBe('SYNTHETIC rules'); expect(payload.first_look.status).toBe('unreviewed'); expect(payload.candidate).toBeNull();
});
