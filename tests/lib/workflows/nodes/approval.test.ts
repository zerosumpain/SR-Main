import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the engine-interactions DB helper so the pause path is exercised
// without a database — same approach as interactive-step.test.ts. No scraper
// module is mocked because the approval node must NOT import any scraper code.
const { createInteraction } = vi.hoisted(() => ({
  createInteraction: vi.fn(),
}));

vi.mock('$lib/workflows/engine-interactions', () => ({
  createInteraction: (...a: any[]) => createInteraction(...a),
}));

// Import the executor module directly (not via the global registry) so the
// test is isolated from registration order.
import { approvalExecutor, approvalDef } from '$lib/workflows/nodes/approval';

const ctx: any = {
  runId: 'run-uuid-1',
  workflowId: 'wf-1',
  _currentNodeId: 'node-approval-1',
  emit: vi.fn(),
};

describe('approvalExecutor — pause path', () => {
  beforeEach(() => {
    createInteraction.mockReset();
  });

  it('creates a confirm interaction and returns the pause sentinel', async () => {
    createInteraction.mockResolvedValue(77);

    const result = await approvalExecutor.execute(
      { email: 'draft' },
      { prompt: 'Approve sending?', timeoutMinutes: 30 },
      ctx,
    );

    expect(createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-uuid-1',
        nodeId: 'node-approval-1',
        mode: 'confirm',
        prompt: 'Approve sending?',
        timeoutMinutes: 30,
      }),
    );
    expect(result.pause?.reason).toBe('awaiting_human');
    expect(result.pause?.interactionId).toBe(77);
    // No branch is selected while paused — the decision arrives on resume.
    expect(result.metadata?._selectedHandle).toBeUndefined();
  });

  it('surfaces an `approved` boolean field for the resolve form', async () => {
    createInteraction.mockResolvedValue(78);
    await approvalExecutor.execute({}, { prompt: 'Go?' }, ctx);
    const opts = createInteraction.mock.calls[0][0];
    const fields = opts.configSnapshot.fields;
    expect(fields).toEqual([{ name: 'approved', type: 'boolean', label: 'Go?' }]);
  });
});

describe('approvalExecutor — auto-decision path', () => {
  beforeEach(() => {
    createInteraction.mockReset();
  });

  it('approves without pausing when decisionPath resolves to true', async () => {
    const result = await approvalExecutor.execute(
      { autoApprove: true, payload: 'keep' },
      { prompt: 'x', decisionPath: 'autoApprove' },
      ctx,
    );
    expect(createInteraction).not.toHaveBeenCalled();
    expect(result.pause).toBeUndefined();
    expect(result.output.approved).toBe(true);
    expect(result.output.payload).toBe('keep');
    expect(result.metadata?._selectedHandle).toBe('approved');
  });

  it('rejects without pausing when decisionPath resolves to false', async () => {
    const result = await approvalExecutor.execute(
      { autoApprove: false },
      { prompt: 'x', decisionPath: 'autoApprove' },
      ctx,
    );
    expect(createInteraction).not.toHaveBeenCalled();
    expect(result.output.approved).toBe(false);
    expect(result.metadata?._selectedHandle).toBe('rejected');
  });

  it('falls back to pausing when decisionPath is non-boolean', async () => {
    createInteraction.mockResolvedValue(79);
    const result = await approvalExecutor.execute(
      { autoApprove: 'maybe' },
      { prompt: 'x', decisionPath: 'autoApprove' },
      ctx,
    );
    expect(createInteraction).toHaveBeenCalled();
    expect(result.pause?.interactionId).toBe(79);
  });
});

describe('approvalDef', () => {
  it('is control category', () => {
    expect(approvalDef.category).toBe('control');
  });
  it('declares approved and rejected output handles', () => {
    expect(approvalDef.outputs.find((o) => o.name === 'approved')).toBeDefined();
    expect(approvalDef.outputs.find((o) => o.name === 'rejected')).toBeDefined();
  });
});
