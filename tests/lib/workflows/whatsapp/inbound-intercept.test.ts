import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real modules pull in engine-resume → the eager node-registry barrel; the
// intercept only needs their { handled } / { dispatched } contracts here.
const mockHandleApprovalReply = vi.fn();
const mockDispatchWhatsAppWorkflow = vi.fn();

vi.mock('$lib/workflows/whatsapp/approval-inbound', () => ({
  handleApprovalReply: (...args: unknown[]) => mockHandleApprovalReply(...args),
}));
vi.mock('$lib/workflows/whatsapp/workflow-dispatch', () => ({
  dispatchWhatsAppWorkflow: (...args: unknown[]) => mockDispatchWhatsAppWorkflow(...args),
}));

const { interceptOwnerInbound } = await import('$lib/workflows/whatsapp/inbound-intercept');

beforeEach(() => {
  vi.clearAllMocks();
  mockHandleApprovalReply.mockResolvedValue({ handled: false });
  mockDispatchWhatsAppWorkflow.mockResolvedValue({ dispatched: false });
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
});
