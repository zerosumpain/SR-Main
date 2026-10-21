import { beforeEach, describe, expect, it, vi } from 'vitest';

// v8 decision routes on the phone lane: who may do what. The device gate,
// the roster and the decision work are stubs; the access rules (`tripAccess`,
// `canDecide`) and the route wiring are real.
const TRIP_ID = '11111111-1111-4111-8111-111111111111';

const h = vi.hoisted(() => ({
  who: 'owner@example.test' as string,
  family: true,
  calls: [] as Array<{ fn: string; args: unknown[] }>,
  outcome: { status: 200, body: { proposals: [] } } as { status: number; body: Record<string, unknown> },
  jobs: [] as string[],
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: h.who }, h.who === 'owner@example.test' ? 'owner' : 'member');
      return r instanceof Response ? r : Response.json(r);
    },
}));
vi.mock('$lib/family/access.server', () => ({
  familyCaller: async () => (h.family ? { email: h.who, parent: h.who !== 'kid@example.test' } : null),
}));
vi.mock('$lib/family/roster.server', () => ({
  familyPersonFor: async (email: string, parent: boolean) => ({ id: `f_${email.split('@')[0]}`, email, name: email.split('@')[0], parent, pilot: true }),
  familyRoster: async () => [],
}));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test', getOwnerEmails: () => ['owner@example.test'] }));
vi.mock('$lib/server/push-devices', () => ({ pushToEmails: async () => ({ sent: 0 }) }));
vi.mock('$lib/trips/store.server', () => ({
  getTripById: async (id: string) => (id === TRIP_ID ? { id: TRIP_ID, title: 'Rome', ownerEmail: 'owner@example.test', timeZone: 'Europe/Rome', profile: null } : null),
}));
vi.mock('$lib/trips/converse.server', () => ({ applyAndReplan: async () => ({}), logEdit: async () => {}, applyDirect: async () => ({}) }));
const record = (fn: string) => async (...args: unknown[]) => {
  h.calls.push({ fn, args });
  return h.outcome;
};
vi.mock('$lib/trips/proposals.server', () => ({ generateProposals: record('generate'), acceptProposal: record('accept'), rejectProposal: record('reject') }));
vi.mock('$lib/trips/undo.server', () => ({ undoTo: record('undo') }));
vi.mock('$lib/trips/brief.server', () => ({ patchBrief: record('brief') }));
vi.mock('$lib/trips/undo.store.server', () => ({ listVersions: async () => [{ version: 5, source: 'site', createdAt: 'x', changes: [], restorable: true }] }));
vi.mock('$lib/trips/decisions.bundle.server', () => ({
  decisionsWire: async (_t: unknown, access: unknown, opts: unknown) => ({ brief: { items: [], assumed: 0, missing: [] }, questions: [], answered: [], proposals: [], pack: { status: 'none' }, access, opts }),
}));
vi.mock('$lib/trips/jobs.server', () => ({
  wantsAsync: (b: unknown) => !!b && typeof b === 'object' && (b as { async?: unknown }).async === true,
  startJob: (_o: string, kind: string) => {
    h.jobs.push(kind);
    return { id: 'job1', kind, status: 'running' };
  },
  jobAccepted: (job: unknown) => Response.json({ job }, { status: 202 }),
}));

const decisions = await import('./[id]/decisions/+server');
const proposals = await import('./[id]/proposals/+server');
const decide = await import('./[id]/proposals/[pid]/+server');
const undo = await import('./[id]/undo/+server');
const versions = await import('./[id]/versions/+server');
const brief = await import('./[id]/brief/+server');
const { NOT_AN_EDITOR } = await import('$lib/trips/decisions.api.server');

function ev(params: Record<string, string>, init: RequestInit = {}) {
  return { params: { id: TRIP_ID, ...params }, locals: {}, request: new Request('http://x/api/native/trips', init), url: new URL('http://x/api/native/trips') } as never;
}
const body = (method: string, b: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

beforeEach(() => {
  h.who = 'owner@example.test';
  h.family = true;
  h.calls = [];
  h.outcome = { status: 200, body: { proposals: [] } };
  h.jobs = [];
});

describe('v8 decision routes (phone)', () => {
  it('anyone in the family reads the decisions and the versions; the phone gets the phone brief', async () => {
    h.who = 'kid@example.test';
    const r = await decisions.GET(ev({}));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ access: { role: 'member', canEdit: false }, opts: { surface: 'phone' } });
    expect((await versions.GET(ev({}))).status).toBe(200);
  });

  it('a member cannot propose, decide, undo or edit the brief — they suggest instead', async () => {
    h.who = 'kid@example.test';
    for (const res of [
      await proposals.POST(ev({}, body('POST', { kind: 'fill', target: { date: '2026-10-27', stage: 'afternoon' } }))),
      await decide.POST(ev({ pid: 'p1' }, body('POST', { action: 'accept' }))),
      await undo.POST(ev({}, body('POST', {}))),
      await brief.PATCH(ev({}, body('PATCH', { field: 'pace', pace: 'relaxed' }))),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: NOT_AN_EDITOR });
    }
    expect(h.calls).toEqual([]);
  });

  it('a parent and the creator may; the request is read and handed on', async () => {
    h.who = 'parent@example.test';
    const r = await proposals.POST(ev({}, body('POST', { kind: 'nudge', target: { proposalId: 'p1' }, nudge: 'closer' })));
    expect(r.status).toBe(200);
    expect(h.calls[0]).toMatchObject({ fn: 'generate', args: [{ id: TRIP_ID }, { kind: 'nudge', nudge: 'closer', target: { proposalId: 'p1' } }, { email: 'parent@example.test', name: 'parent', surface: 'phone', isOwner: false }] });

    h.who = 'owner@example.test';
    await decide.POST(ev({ pid: 'p9' }, body('POST', { action: 'reject', reason: 'too-busy' })));
    expect(h.calls[1]).toMatchObject({ fn: 'reject', args: [{ id: TRIP_ID }, 'p9', 'too-busy', { email: 'owner@example.test', isOwner: true }, null] });
    await undo.POST(ev({}, body('POST', { toVersion: 3 })));
    expect(h.calls[2]).toMatchObject({ fn: 'undo', args: [{ id: TRIP_ID }, 3, { surface: 'phone' }] });
    await brief.PATCH(ev({}, body('PATCH', { field: 'pace', pace: 'relaxed' })));
    expect(h.calls[3]).toMatchObject({ fn: 'brief', args: [{ id: TRIP_ID }, { field: 'pace', pace: 'relaxed' }, { surface: 'phone' }] });
  });

  it('passes the outcome’s status through — a stale proposal is a 409 with the new difference', async () => {
    h.outcome = { status: 409, body: { stale: true, proposal: { id: 'p1' } } };
    const r = await decide.POST(ev({ pid: 'p1' }, body('POST', { action: 'accept' })));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ stale: true, proposal: { id: 'p1' } });
  });

  it('long work as a job with "async": true', async () => {
    const r = await decide.POST(ev({ pid: 'p1' }, body('POST', { action: 'accept', async: true })));
    expect(r.status).toBe(202);
    expect(h.jobs).toEqual(['ideas']);
  });

  it('says what is wrong with a bad request', async () => {
    expect((await proposals.POST(ev({}, body('POST', { kind: 'fill' })))).status).toBe(400);
    expect((await decide.POST(ev({ pid: 'p1' }, body('POST', { action: 'maybe' })))).status).toBe(400);
    expect((await undo.POST(ev({}, body('POST', { toVersion: 'last' })))).status).toBe(400);
    expect((await brief.PATCH(ev({}, body('PATCH', { field: 'colour' })))).status).toBe(400);
  });

  it('is for the family only, and only real trips', async () => {
    h.family = false;
    expect((await decisions.GET(ev({}))).status).toBe(403);
    h.family = true;
    expect((await decisions.GET(ev({ id: 'nope' }))).status).toBe(404);
  });
});
