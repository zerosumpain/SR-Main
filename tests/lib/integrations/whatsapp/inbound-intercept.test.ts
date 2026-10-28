import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real modules pull in engine-resume → the eager node-registry barrel; the
// intercept only needs their { handled } / { dispatched } contracts here.
const mockHandleApprovalReply = vi.fn();
const mockDispatchWhatsAppWorkflow = vi.fn();

vi.mock('$lib/integrations/whatsapp/approval-inbound', () => ({
  handleApprovalReply: (...args: unknown[]) => mockHandleApprovalReply(...args),
}));
const mockHandleReplyCode = vi.fn();
vi.mock('$lib/integrations/whatsapp/reply-code.server', () => ({
  handleReplyCode: (...args: unknown[]) => mockHandleReplyCode(...args),
}));
vi.mock('$lib/integrations/whatsapp/workflow-dispatch', () => ({
  dispatchWhatsAppWorkflow: (...args: unknown[]) => mockDispatchWhatsAppWorkflow(...args),
}));

const emitted = vi.hoisted(() => [] as unknown[][]);
vi.mock('$lib/events/platform-bus', () => ({ emit: (...a: unknown[]) => emitted.push(a) }));
vi.mock('$lib/config/owner-number', () => ({ isOwnerNumber: (n: string) => n.replace(/\D+/g, '') === '447359228511' }));

const { interceptOwnerInbound } = await import('$lib/integrations/whatsapp/inbound-intercept');

beforeEach(() => {
  vi.clearAllMocks();
  emitted.length = 0;
  mockHandleApprovalReply.mockResolvedValue({ handled: false });
  mockDispatchWhatsAppWorkflow.mockResolvedValue({ dispatched: false });
  mockHandleReplyCode.mockResolvedValue({ handled: false });
});

describe('the reply-code step', () => {
  it('runs first for the owner and consumes a code it handled', async () => {
    mockHandleReplyCode.mockResolvedValue({ handled: true, reply: 'Done: lights off.' });
    expect(await interceptOwnerInbound('447359228511', '4831')).toEqual({ handled: true, reply: 'Done: lights off.' });
    expect(mockHandleApprovalReply).not.toHaveBeenCalled();
  });

  it('is never asked about a stranger', async () => {
    await interceptOwnerInbound('447700900999', '4831');
    expect(mockHandleReplyCode).not.toHaveBeenCalled();
  });

  it('lets an unhandled message carry on to approvals and dispatch', async () => {
    await interceptOwnerInbound('447359228511', 'hello');
    expect(mockHandleReplyCode).toHaveBeenCalledWith('447359228511', 'hello');
    expect(mockHandleApprovalReply).toHaveBeenCalled();
  });
});

describe('interceptOwnerInbound (delegated-mode entry point for D2/D3)', () => {
  it('resolves a handled approval reply and does NOT reach dispatch', async () => {
    mockHandleApprovalReply.mockResolvedValue({ handled: true, reply: '✓ Approved.' });
    const r = await interceptOwnerInbound('447359228511', 'APPROVE ABC123');
    expect(r).toEqual({ handled: true, reply: '✓ Approved.' });
    expect(mockHandleApprovalReply).toHaveBeenCalledWith('447359228511', 'APPROVE ABC123');
    expect(mockDispatchWhatsAppWorkflow).not.toHaveBeenCalled();
  });

  it('dispatches a matching whatsapp-trigger when no approval matched', async () => {
    mockDispatchWhatsAppWorkflow.mockResolvedValue({ dispatched: true, workflowName: 'News Digest' });
    const r = await interceptOwnerInbound('447359228511', 'news bitcoin');
    expect(r).toEqual({ handled: true, reply: '▶ Started News Digest' });
    expect(mockDispatchWhatsAppWorkflow).toHaveBeenCalledWith('447359228511', 'news bitcoin');
    // Approval intercept always runs first (approve/deny/yes/no own their keywords).
    const approvalOrder = mockHandleApprovalReply.mock.invocationCallOrder[0];
    const dispatchOrder = mockDispatchWhatsAppWorkflow.mock.invocationCallOrder[0];
    expect(approvalOrder).toBeLessThan(dispatchOrder);
  });

  it('falls through (handled:false) when neither intercept consumes the message', async () => {
    const r = await interceptOwnerInbound('447359228511', 'hello there');
    expect(r).toEqual({ handled: false });
    expect(mockHandleApprovalReply).toHaveBeenCalled();
    expect(mockDispatchWhatsAppWorkflow).toHaveBeenCalled();
  });

  it('raises whatsapp.inbound for the owner, whatever consumes the message', async () => {
    mockDispatchWhatsAppWorkflow.mockResolvedValue({ dispatched: true, workflowName: 'X' });
    await interceptOwnerInbound('447359228511', 'lights off');
    expect(emitted).toEqual([['whatsapp.inbound', { from: '447359228511', text: 'lights off' }, { source: 'whatsapp-inbound' }]]);
  });

  it('never raises an event for someone else', async () => {
    await interceptOwnerInbound('15550001111', 'lights off');
    expect(emitted).toHaveLength(0);
  });
});
