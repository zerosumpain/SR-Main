import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.execute drives findPendingApprovalByCode; set `executeRows` per test.
let executeRows: Record<string, unknown>[] = [];
vi.mock('$lib/db', () => ({
  db: { execute: () => Promise.resolve({ rows: executeRows }) },
}));

// resolveInteraction is the shared resolve/resume path — mocked so we can assert
// the verdict without a real engine.
const resolveInteraction = vi.fn(
  async (_opts: unknown): Promise<{ resolved: boolean; reason?: string }> => ({ resolved: true }),
);
// Wrap in an arrow so the hoisted vi.mock factory doesn't touch the const before
// it's initialised (object shorthand would evaluate it immediately).
vi.mock('$lib/workflows/engine-resume', () => ({
  resolveInteraction: (opts: unknown) => resolveInteraction(opts),
}));

import { handleApprovalReply } from './approval-inbound';

const OWNER = '447359228511'; // matches default OWNER_PHONE +447359228511
const NOT_OWNER = '447000000000';

function futureIso(msFromNow = 3_600_000): string {
  return new Date(Date.now() + msFromNow).toISOString();
}
function pastIso(): string {
  return new Date(Date.now() - 1000).toISOString();
}

function lookupRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 'run1',
    nodeId: 'node1',
    workflowId: 'wf1',
    workflowName: 'canvas:news-pipeline',
    workflowDescription: 'News Pipeline',
    configSnapshot: { waApproval: { code: 'ABC234', expiresAt: futureIso() } },
    resolvedAt: null,
    cancelled: false,
    expiresAt: futureIso(),
    ...overrides,
  };
}

beforeEach(() => {
  executeRows = [];
  resolveInteraction.mockClear();
  resolveInteraction.mockResolvedValue({ resolved: true });
});

describe('handleApprovalReply — gating (owner + shape)', () => {
  it('falls through untouched for a non-owner sender even with a valid code', async () => {
    const res = await handleApprovalReply(NOT_OWNER, 'approve ABC234');
    expect(res).toEqual({ handled: false });
    expect(resolveInteraction).not.toHaveBeenCalled();
  });

  it('falls through untouched for a non-approval message from the owner', async () => {
    const res = await handleApprovalReply(OWNER, 'what is the weather today?');
    expect(res).toEqual({ handled: false });
    expect(resolveInteraction).not.toHaveBeenCalled();
  });

  it('treats a "+"-prefixed owner number as the owner', async () => {
    executeRows = [lookupRow()];
    const res = await handleApprovalReply('+44 7359 228511', 'approve ABC234');
    expect(res.handled).toBe(true);
    expect(resolveInteraction).toHaveBeenCalledTimes(1);
  });
});

describe('handleApprovalReply — token validation', () => {
  it('falls through to chat when no interaction matches the code', async () => {
    // A code that matches nothing is not a real approval reply — do not swallow
    // the message; let it reach general chat.
    executeRows = [];
    const res = await handleApprovalReply(OWNER, 'approve ABC234');
    expect(res).toEqual({ handled: false });
    expect(resolveInteraction).not.toHaveBeenCalled();
  });

  it('does not swallow common owner chat that fits the shape ("yes please")', async () => {
    // "yes please" / "no thanks" match the loose verb+6-char shape but carry no
    // real code, so they must fall through to general chat untouched.
    executeRows = [];
    for (const phrase of ['yes please', 'no thanks', 'deny access']) {
      const res = await handleApprovalReply(OWNER, phrase);
      expect(res).toEqual({ handled: false });
    }
    expect(resolveInteraction).not.toHaveBeenCalled();
  });

  it('replies (handled) when the interaction was cancelled', async () => {
    executeRows = [lookupRow({ cancelled: true })];
    const res = await handleApprovalReply(OWNER, 'approve ABC234');
    expect(res.handled).toBe(true);
    expect(res.reply).toContain('no longer active');
    expect(resolveInteraction).not.toHaveBeenCalled();
  });

  it('replies (handled) when the interaction was already resolved', async () => {
    executeRows = [lookupRow({ resolvedAt: new Date().toISOString() })];
    const res = await handleApprovalReply(OWNER, 'approve ABC234');
    expect(res.handled).toBe(true);
    expect(res.reply).toContain('already handled');
    expect(resolveInteraction).not.toHaveBeenCalled();
  });

  it('replies (handled) when the token itself has expired', async () => {
    executeRows = [lookupRow({ configSnapshot: { waApproval: { code: 'ABC234', expiresAt: pastIso() } } })];
    const res = await handleApprovalReply(OWNER, 'approve ABC234');
    expect(res.handled).toBe(true);
    expect(res.reply).toContain('has expired');
    expect(resolveInteraction).not.toHaveBeenCalled();
  });

  it('replies (handled) when the interaction window has expired', async () => {
    executeRows = [lookupRow({ expiresAt: pastIso() })];
    const res = await handleApprovalReply(OWNER, 'approve ABC234');
    expect(res.handled).toBe(true);
    expect(res.reply).toContain('has expired');
    expect(resolveInteraction).not.toHaveBeenCalled();
  });
});

describe('handleApprovalReply — resolution', () => {
  it('resolves APPROVE with approved:true and confirms', async () => {
    executeRows = [lookupRow()];
    const res = await handleApprovalReply(OWNER, 'approve ABC234');
    expect(resolveInteraction).toHaveBeenCalledTimes(1);
    expect(resolveInteraction).toHaveBeenCalledWith({
      runId: 'run1',
      nodeId: 'node1',
      formValues: { approved: true },
      resolvedBy: `whatsapp:${OWNER}`,
    });
    expect(res.handled).toBe(true);
    expect(res.reply).toContain('✓ Approved');
    expect(res.reply).toContain('News Pipeline');
  });

  it('resolves DENY with approved:false and confirms', async () => {
    executeRows = [lookupRow()];
    const res = await handleApprovalReply(OWNER, 'deny ABC234');
    expect(resolveInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ formValues: { approved: false } }),
    );
    expect(res.reply).toContain('✗ Denied');
  });

  it('maps the YES alias to approved and NO to rejected', async () => {
    executeRows = [lookupRow()];
    await handleApprovalReply(OWNER, 'yes ABC234');
    expect(resolveInteraction).toHaveBeenLastCalledWith(
      expect.objectContaining({ formValues: { approved: true } }),
    );
    executeRows = [lookupRow()];
    await handleApprovalReply(OWNER, 'no ABC234');
    expect(resolveInteraction).toHaveBeenLastCalledWith(
      expect.objectContaining({ formValues: { approved: false } }),
    );
  });

  it('reports "already handled" when resolve loses a race (not_pending)', async () => {
    executeRows = [lookupRow()];
    resolveInteraction.mockResolvedValueOnce({ resolved: false, reason: 'not_pending' });
    const res = await handleApprovalReply(OWNER, 'approve ABC234');
    expect(res.handled).toBe(true);
    expect(res.reply).toContain('already handled');
  });

  it('reports "no longer active" when resolve loses a race (cancelled)', async () => {
    executeRows = [lookupRow()];
    resolveInteraction.mockResolvedValueOnce({ resolved: false, reason: 'cancelled' });
    const res = await handleApprovalReply(OWNER, 'approve ABC234');
    expect(res.handled).toBe(true);
    expect(res.reply).toContain('no longer active');
  });

  it('handles (does not fall through) and replies gracefully on an unexpected error', async () => {
    executeRows = [lookupRow()];
    resolveInteraction.mockRejectedValueOnce(new Error('db down'));
    const res = await handleApprovalReply(OWNER, 'approve ABC234');
    expect(res.handled).toBe(true);
    expect(res.reply).toContain('Something went wrong');
  });
});
