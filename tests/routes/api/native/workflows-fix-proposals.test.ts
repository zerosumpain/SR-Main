import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The phone lists and resolves self-heal fix proposals through PR A's module —
 * the canvas banner's path — plus the phone's own refusal of destructive fixes.
 */

let paired = true;
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => (paired ? { id: 'dev-1', ownerEmail: 'owner@example.com' } : null),
  touchDevice: async () => {},
}));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.com' } }));
vi.mock('$lib/workflows/native/workflows.server', () => ({
  findCanvas: async (slug: string) => (slug === 'morning' ? { id: 'wf-1', name: 'canvas:morning' } : null),
  currentGraphVersion: async () => 42,
}));
vi.mock('$lib/canvas/mutate.server', async (orig) => ({
  ...(await orig<typeof import('$lib/canvas/mutate.server')>()),
}));

const proposal = (over: Record<string, unknown> = {}) => ({
  id: 'fp-1',
  workflowId: 'wf-1',
  nodeId: 'n-1',
  nodeLabel: 'Fetch',
  description: 'Use POST',
  createdAt: '2026-09-25T06:00:00.000Z',
  updatedAt: '2026-09-25T06:00:00.000Z',
  runId: 'run-1',
  status: 'pending',
  changes: { method: 'POST' },
  occurrences: 2,
  ...over,
});

const listFixProposals = vi.fn();
const acceptFixProposal = vi.fn();
const dismissFixProposal = vi.fn();
vi.mock('$lib/workflows/fix-proposals.server', async (orig) => {
  const real = await orig<typeof import('$lib/workflows/fix-proposals.server')>();
  return {
    ...real,
    listFixProposals: (...a: unknown[]) => listFixProposals(...a),
    acceptFixProposal: (...a: unknown[]) => acceptFixProposal(...a),
    dismissFixProposal: (...a: unknown[]) => dismissFixProposal(...a),
  };
});

import { FixProposalNotPendingError } from '$lib/workflows/fix-proposals.server';

function req(url: string, body?: unknown) {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
  });
}

async function list(slug = 'morning') {
  const mod = await import('../../../../src/routes/api/native/workflows/[slug]/fix-proposals/+server');
  const request = req(`http://x/api/native/workflows/${slug}/fix-proposals`);
  return (mod.GET as (e: unknown) => Promise<Response>)({ params: { slug }, request, url: new URL(request.url) });
}

async function act(action: unknown, id = 'fp-1', slug = 'morning') {
  const mod = await import('../../../../src/routes/api/native/workflows/[slug]/fix-proposals/[id]/+server');
  const request = req(`http://x/api/native/workflows/${slug}/fix-proposals/${id}`, { action });
  return (mod.POST as (e: unknown) => Promise<Response>)({ params: { slug, id }, request, url: new URL(request.url) });
}

beforeEach(() => {
  paired = true;
  listFixProposals.mockReset().mockResolvedValue([proposal()]);
  acceptFixProposal.mockReset().mockResolvedValue({
    proposal: proposal({ status: 'accepted' }),
    amend: { workflowId: 'wf-1', outcomes: [{ op: 'update_node', summary: 'updated "Fetch"', nodeId: 'n-1' }] },
  });
  dismissFixProposal.mockReset().mockResolvedValue(proposal({ status: 'dismissed' }));
});

describe('GET /api/native/workflows/[slug]/fix-proposals', () => {
  it('lists pending proposals in the shared wire shape', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposals).toEqual([
      {
        id: 'fp-1',
        nodeId: 'n-1',
        nodeLabel: 'Fetch',
        description: 'Use POST',
        createdAt: '2026-09-25T06:00:00.000Z',
        runId: 'run-1',
        changedKeys: ['method'],
        occurrences: 2,
      },
    ]);
    expect(listFixProposals).toHaveBeenCalledWith('wf-1');
  });

  it('404s an unknown slug and 401s an unpaired phone', async () => {
    expect((await list('nope')).status).toBe(404);
    paired = false;
    expect((await list()).status).toBe(401);
  });
});

describe('POST /api/native/workflows/[slug]/fix-proposals/[id]', () => {
  it('accepts through acceptFixProposal and returns the new graph version', async () => {
    const res = await act('accept');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'accepted', version: 42, outcomes: [{ op: 'update_node', nodeId: 'n-1' }] });
    expect(acceptFixProposal).toHaveBeenCalledWith('wf-1', 'fp-1');
  });

  it('dismisses through dismissFixProposal', async () => {
    const body = await (await act('dismiss')).json();
    expect(body.status).toBe('dismissed');
    expect(dismissFixProposal).toHaveBeenCalledWith('wf-1', 'fp-1');
    expect(acceptFixProposal).not.toHaveBeenCalled();
  });

  it('refuses a fix that would switch on a destructive tool, without applying it', async () => {
    listFixProposals.mockResolvedValue([proposal({ changes: { allowDestructive: true } })]);
    const res = await act('accept');
    expect(res.status).toBe(422);
    expect((await res.json()).field).toBe('allowDestructive');
    expect(acceptFixProposal).not.toHaveBeenCalled();
  });

  it('answers 409 for a fix already dealt with, 422 for a bad action', async () => {
    acceptFixProposal.mockRejectedValue(new FixProposalNotPendingError('fp-1', 'dismissed'));
    expect((await act('accept')).status).toBe(409);
    expect((await act('apply')).status).toBe(422);
  });
});
