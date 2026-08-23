import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the WhatsApp service
const mockSendMessage = vi.fn();
const mockGetState = vi.fn();

vi.mock('$lib/workflows/whatsapp/service', () => ({
  getWhatsAppService: () => ({
    sendMessage: mockSendMessage,
    getState: mockGetState,
  }),
}));

import { whatsappExecutor, whatsappDef } from '$lib/workflows/nodes/whatsapp';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'run-1',
  workflowId: 'wf-1',
  workspaceDir: '/tmp',
  dryRun: false,
  emit: vi.fn(),
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
  getOutgoingEdges: vi.fn().mockReturnValue([]),
  getIncomingEdges: vi.fn().mockReturnValue([]),
  getNodeConfig: vi.fn(),
};

describe('whatsappExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({ status: 'connected' });
  });

  it('sends a message with interpolated templates', async () => {
    mockSendMessage.mockResolvedValue({ sent: true, messageId: 'msg-abc' });

    const result = await whatsappExecutor.execute(
      { output: { name: 'John', summary: 'All good' } },
      { to: '+447359228511', message: 'Hi {{input.output.name}}, report: {{input.output.summary}}' },
      mockContext,
    );

    expect(mockSendMessage).toHaveBeenCalledWith(
      '+447359228511',
      'Hi John, report: All good',
    );
    expect(result.output.sent).toBe(true);
    expect(result.output.messageId).toBe('msg-abc');
  });

  it('THROWS when WhatsApp is not connected — the run must not report success', async () => {
    mockGetState.mockReturnValue({ status: 'disconnected' });
    mockSendMessage.mockResolvedValue({ sent: false, error: 'WhatsApp not connected' });

    // Previously this returned `sent: false` and the engine recorded the node
    // AND the run as `completed` — a delivery node reporting success while
    // delivering nothing.
    await expect(
      whatsappExecutor.execute({}, { to: '+447359228511', message: 'test' }, mockContext),
    ).rejects.toThrow(/WhatsApp not connected/);
  });

  it('THROWS when no recipient is configured', async () => {
    await expect(
      whatsappExecutor.execute({}, { to: '', message: 'test' }, mockContext),
    ).rejects.toThrow(/no recipient/i);
  });
});

describe('whatsappDef', () => {
  it('is an integration node', () => {
    expect(whatsappDef.type).toBe('whatsapp');
    expect(whatsappDef.category).toBe('integration');
  });

  it('has input and output ports', () => {
    expect(whatsappDef.inputs).toHaveLength(1);
    expect(whatsappDef.outputs).toHaveLength(1);
  });

  it('has basicConfig fields', () => {
    expect(whatsappDef.basicConfig).toBeDefined();
    expect(whatsappDef.basicConfig!.length).toBeGreaterThanOrEqual(2);
  });

  it('has llmDescription for the orchestrator', () => {
    expect(whatsappDef.llmDescription).toBeDefined();
    expect(whatsappDef.llmDescription!.length).toBeGreaterThan(20);
  });
});
