import { beforeEach, describe, expect, it, vi } from 'vitest';

// v8 decision routes on the site lane: the owner's session only (or the
// dev-only LAN bypass); everyone else gets the site's 403. The decision work
// is stubbed; the guard and the wiring are real.
const h = vi.hoisted(() => ({ email: null as string | null, calls: [] as Array<{ fn: string; args: unknown[] }> }));

vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test', getOwnerEmails: () => ['owner@example.test'] }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => false }));
vi.mock('$lib/trips/store.server', () => ({ getTrip: async (_o: string, id: string) => (id === 't1' ? { id: 't1', ownerEmail: 'owner@example.test' } : null) }));
vi.mock('$lib/trips/converse.server', () => ({ logEdit: async () => {}, applyDirect: async () => ({}) }));
const record = (fn: string) => async (...args: unknown[]) => {
  h.calls.push({ fn, args });
  return { status: 200, body: { ok: fn } };
};
vi.mock('$lib/trips/proposals.server', () => ({ generateProposals: record('generate'), acceptProposal: record('accept'), rejectProposal: record('reject') }));
vi.mock('$lib/trips/undo.server', () => ({ undoTo: record('undo') }));
vi.mock('$lib/trips/brief.server', () => ({ patchBrief: record('brief') }));
vi.mock('$lib/trips/undo.store.server', () => ({ listVersions: async () => [{ version: 2, source: 'site', createdAt: 'x', changes: ['Undone: back to version 1.'], restorable: true }] }));
vi.mock('$lib/trips/decisions.bundle.server', () => ({
  decisionsWire: async (_t: unknown, access: unknown, opts: unknown) => ({ access, opts }),
}));

const decisions = await import('./[id]/decisions/+server');
const proposals = await import('./[id]/proposals/+server');
const decide = await import('./[id]/proposals/[pid]/+server');
const undo = await import('./[id]/undo/+server');
const versions = await import('./[id]/versions/+server');
const brief = await import('./[id]/brief/+server');

function ev(params: Record<string, string> = {}, init: RequestInit = {}) {
  return {
    params: { id: 't1', ...params },
    locals: { auth: async () => (h.email ? { user: { email: h.email } } : null) },
    getClientAddress: () => '100.83.68.1',
    request: new Request('http://x/api/trips/t1', init),
  } as never;
}
const body = (method: string, b: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

async function status(p: Promise<Response>): Promise<number> {
  try {
    return (await p).status;
  } catch (err) {
    return (err as { status: number }).status;
  }
}

beforeEach(() => {
  h.email = null;
  h.calls = [];
});

describe('v8 decision routes (site)', () => {
  it('refuse anyone but the owner', async () => {
    for (const email of [null, 'kid@example.test']) {
      h.email = email;
      expect(await status(decisions.GET(ev()))).toBe(403);
      expect(await status(proposals.POST(ev({}, body('POST', { kind: 'fill', target: { date: '2026-10-27', stage: 'lunch' } }))))).toBe(403);
      expect(await status(decide.POST(ev({ pid: 'p1' }, body('POST', { action: 'accept' }))))).toBe(403);
      expect(await status(undo.POST(ev({}, body('POST', {}))))).toBe(403);
      expect(await status(versions.GET(ev()))).toBe(403);
      expect(await status(brief.PATCH(ev({}, body('PATCH', { field: 'pace', pace: 'packed' }))))).toBe(403);
    }
    expect(h.calls).toEqual([]);
  });

  it('the owner gets the site’s full brief and may decide', async () => {
    h.email = 'owner@example.test';
    expect(await (await decisions.GET(ev())).json()).toEqual({ access: expect.objectContaining({ role: 'creator', canEdit: true }), opts: { surface: 'site' } });
    expect(await (await versions.GET(ev())).json()).toEqual({ versions: [expect.objectContaining({ version: 2, restorable: true })] });
    await proposals.POST(ev({}, body('POST', { kind: 'swap', target: { stopId: 'w1' } })));
    await decide.POST(ev({ pid: 'p1' }, body('POST', { action: 'accept' })));
    await undo.POST(ev({}, body('POST', {})));
    await brief.PATCH(ev({}, body('PATCH', { field: 'confirm', key: 'meal-times' })));
    expect(h.calls.map((c) => c.fn)).toEqual(['generate', 'accept', 'undo', 'brief']);
    expect(h.calls[0].args[2]).toMatchObject({ email: 'owner@example.test', surface: 'site', isOwner: true });
    expect(h.calls[2].args[1]).toBeNull();
  });

  it('404s a trip that is not there', async () => {
    h.email = 'owner@example.test';
    expect(await status(decisions.GET(ev({ id: 'nope' })))).toBe(404);
  });
});
