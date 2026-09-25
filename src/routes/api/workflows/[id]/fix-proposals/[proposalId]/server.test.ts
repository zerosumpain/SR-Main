import { describe, it, expect, vi, beforeEach } from 'vitest';

const mod = vi.hoisted(() => {
  class FixProposalNotFoundError extends Error {}
  class FixProposalNotPendingError extends Error {}
  return {
    FixProposalNotFoundError,
    FixProposalNotPendingError,
    acceptFixProposal: vi.fn(),
    dismissFixProposal: vi.fn(),
    toFixProposalDTO: (p: { id: string }) => ({ id: p.id }),
  };
});
vi.mock('$lib/workflows/fix-proposals.server', () => mod);

const amend = vi.hoisted(() => {
  class AmendOpError extends Error {
    cause: unknown;
    constructor(cause: unknown) {
      super('op failed');
      this.cause = cause;
    }
  }
  class WorkflowNotFoundError extends Error {}
  return { AmendOpError, WorkflowNotFoundError };
});
vi.mock('$lib/canvas/amend.server', () => amend);

const mutate = vi.hoisted(() => {
  class NodeNotFoundError extends Error {}
  class SensitiveRefusalError extends Error {
    fields = ['apiKey'];
  }
  return { NodeNotFoundError, SensitiveRefusalError };
});
vi.mock('$lib/canvas/mutate.server', () => mutate);

import { POST } from './+server';

function call(action: unknown) {
  return POST({
    params: { id: 'wf-1', proposalId: 'wf-1:n1:abc' },
    request: new Request('http://x', { method: 'POST', body: JSON.stringify({ action }) }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  mod.acceptFixProposal.mockReset();
  mod.dismissFixProposal.mockReset();
});

describe('POST /api/workflows/:id/fix-proposals/:proposalId', () => {
  it('rejects an unknown action', async () => {
    expect((await call('apply')).status).toBe(400);
    expect(mod.acceptFixProposal).not.toHaveBeenCalled();
  });

  it('accept goes through acceptFixProposal for this workflow', async () => {
    mod.acceptFixProposal.mockResolvedValue({
      proposal: { id: 'wf-1:n1:abc', status: 'accepted' },
      amend: { outcomes: [{ op: 'update_node', summary: 'updated', nodeId: 'n1' }] },
    });
    const res = await call('accept');
    expect(res.status).toBe(200);
    expect(mod.acceptFixProposal).toHaveBeenCalledWith('wf-1', 'wf-1:n1:abc');
    expect(await res.json()).toMatchObject({ status: 'accepted' });
  });

  it('dismiss goes through dismissFixProposal', async () => {
    mod.dismissFixProposal.mockResolvedValue({ id: 'wf-1:n1:abc', status: 'dismissed' });
    const res = await call('dismiss');
    expect(res.status).toBe(200);
    expect(mod.dismissFixProposal).toHaveBeenCalledWith('wf-1', 'wf-1:n1:abc');
  });

  it('maps the failure modes to statuses', async () => {
    mod.acceptFixProposal.mockRejectedValueOnce(new mod.FixProposalNotFoundError('nope'));
    expect((await call('accept')).status).toBe(404);
    mod.acceptFixProposal.mockRejectedValueOnce(new mod.FixProposalNotPendingError('done'));
    expect((await call('accept')).status).toBe(409);
    mod.acceptFixProposal.mockRejectedValueOnce(new amend.AmendOpError(new mutate.NodeNotFoundError('gone')));
    expect((await call('accept')).status).toBe(409);
    mod.acceptFixProposal.mockRejectedValueOnce(new amend.AmendOpError(new mutate.SensitiveRefusalError('cred')));
    expect((await call('accept')).status).toBe(422);
  });
});
