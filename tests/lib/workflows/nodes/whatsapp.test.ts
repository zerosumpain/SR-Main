import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { ExecutionContext } from '$lib/workflows/types';

// Mock the WhatsApp service boundary.
const mockSendMessage = vi.fn();
const mockSendAttachment = vi.fn();
vi.mock('$lib/workflows/whatsapp/service', () => ({
  getWhatsAppService: () => ({ sendMessage: mockSendMessage, sendAttachment: mockSendAttachment }),
}));

// Mock the (lazy dynamic-imported) data-store helpers used for idempotency.
const mockGetStoreValue = vi.fn();
const mockAppendAtomic = vi.fn();
vi.mock('$lib/workflows/nodes/data-store', () => ({
  getStoreValue: mockGetStoreValue,
  appendAtomic: mockAppendAtomic,
}));

const { whatsappExecutor } = await import('$lib/workflows/nodes/whatsapp');

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    workspaceDir: '/tmp',
    dryRun: false,
    emit: () => {},
    getNodeOutput: () => undefined,
    checkBreakpoint: async () => {},
    abortSignal: new AbortController().signal,
    getOutgoingEdges: () => [],
    getIncomingEdges: () => [],
    getNodeConfig: () => undefined,
    ...overrides,
  } as ExecutionContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessage.mockResolvedValue({ sent: true, messageId: 'm1' });
  mockSendAttachment.mockResolvedValue({ sent: true, messageId: 'a1' });
  mockGetStoreValue.mockResolvedValue({ value: [], found: false });
  mockAppendAtomic.mockResolvedValue([]);
});

describe('whatsapp executor — basic + markdown', () => {
  it('sends a plain message and returns sent', async () => {
    const r = await whatsappExecutor.execute(
      { name: 'Al' },
      { to: '+123', message: 'Hi {{input.name}}', formatMarkdown: false },
      ctx(),
    );
    expect(mockSendMessage).toHaveBeenCalledWith('+123', 'Hi Al');
    expect(r.output).toMatchObject({ sent: true, messageId: 'm1', chunks: 1, suppressed: false });
  });

  it('converts markdown before sending when formatMarkdown is on (default)', async () => {
    await whatsappExecutor.execute({}, { to: '+123', message: 'a **bold** ## nope' }, ctx());
    const sent = mockSendMessage.mock.calls[0][1];
    expect(sent).toContain('*bold*');
    expect(sent).not.toContain('**');
  });

  it('THROWS without a recipient — a node that cannot deliver is not a completed node', async () => {
    await expect(whatsappExecutor.execute({}, { message: 'hi' }, ctx())).rejects.toThrow(
      /no recipient/i,
    );
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('SKIPS (does not throw) when message and media both interpolate empty', async () => {
    // Legitimate: `message` is templated, so a configured node can resolve to
    // nothing when upstream produced no items. That is a skip, not a failure.
    const r = await whatsappExecutor.execute({}, { to: '+123' }, ctx());
    expect(r.output).toMatchObject({ sent: false, skipped: true });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('whatsapp executor — dryRun is send-free on every path', () => {
  it('does not send text', async () => {
    const r = await whatsappExecutor.execute({}, { to: '+123', message: 'hi' }, ctx({ dryRun: true }));
    expect(r.output.simulated).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockAppendAtomic).not.toHaveBeenCalled();
  });

  it('does not send media', async () => {
    const r = await whatsappExecutor.execute(
      {},
      { to: '+123', mediaUrl: 'https://x.co/a.png', caption: 'c' },
      ctx({ dryRun: true }),
    );
    expect(r.output.simulated).toBe(true);
    expect(mockSendAttachment).not.toHaveBeenCalled();
  });

  it('does not send even with a suppression window set', async () => {
    await whatsappExecutor.execute(
      {},
      { to: '+123', message: 'hi', suppressDuplicateWindowMins: 60 },
      ctx({ dryRun: true }),
    );
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockGetStoreValue).not.toHaveBeenCalled();
  });
});

describe('whatsapp executor — chunking', () => {
  it('splits a >4096-char message into sequential sends', async () => {
    const para = 'y'.repeat(3000);
    const message = `${para}\n\n${para}`; // 6002 chars → 2 chunks
    vi.useFakeTimers();
    const p = whatsappExecutor.execute({}, { to: '+123', message, formatMarkdown: false }, ctx());
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    expect(r.output).toMatchObject({ sent: true, chunks: 2 });
    expect((r.output.messageIds as string[]).length).toBe(2);
  });
});

describe('whatsapp executor — idempotency suppression', () => {
  const to = '+15551234567';
  const message = 'Daily digest';
  // Executor hashes `${to}\u0000${message}` (NUL separator, unambiguous).
  const expectedHash = createHash('sha256').update(`${to}\u0000${message}`).digest('hex');

  it('records the hash AFTER a successful send', async () => {
    const r = await whatsappExecutor.execute(
      {},
      { to, message, formatMarkdown: false, suppressDuplicateWindowMins: 1440 },
      ctx(),
    );
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(r.output.sent).toBe(true);
    expect(mockAppendAtomic).toHaveBeenCalledTimes(1);
    const [wfId, key, arr, cap] = mockAppendAtomic.mock.calls[0];
    expect(wfId).toBe('wf-1');
    expect(key).toBe('_wa_sent_hashes');
    expect(arr[0].h).toBe(expectedHash);
    expect(typeof arr[0].ts).toBe('number');
    expect(cap).toBe(200);
  });

  it('skips the send when an identical hash is within the window', async () => {
    mockGetStoreValue.mockResolvedValue({
      value: [{ h: expectedHash, ts: Date.now() - 60_000 }],
      found: true,
    });
    const r = await whatsappExecutor.execute(
      {},
      { to, message, formatMarkdown: false, suppressDuplicateWindowMins: 1440 },
      ctx(),
    );
    expect(r.output).toMatchObject({ sent: false, suppressed: true, skipped: true });
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockAppendAtomic).not.toHaveBeenCalled();
  });

  it('still sends when the matching hash is OUTSIDE the window', async () => {
    mockGetStoreValue.mockResolvedValue({
      value: [{ h: expectedHash, ts: Date.now() - 2 * 24 * 60 * 60 * 1000 }], // 2 days ago
      found: true,
    });
    const r = await whatsappExecutor.execute(
      {},
      { to, message, formatMarkdown: false, suppressDuplicateWindowMins: 1440 }, // 1 day window
      ctx(),
    );
    expect(mockSendMessage).toHaveBeenCalledOnce();
    expect(r.output.sent).toBe(true);
    expect(mockAppendAtomic).toHaveBeenCalledOnce();
  });

  it('THROWS and does NOT record the hash when the send fails', async () => {
    mockSendMessage.mockResolvedValue({ sent: false, error: 'offline' });
    await expect(
      whatsappExecutor.execute(
        {},
        { to, message, formatMarkdown: false, suppressDuplicateWindowMins: 1440 },
        ctx(),
      ),
    ).rejects.toThrow(/offline/);
    expect(mockAppendAtomic).not.toHaveBeenCalled();
  });

  it('does not touch the store when the window is 0 (off)', async () => {
    await whatsappExecutor.execute({}, { to, message, formatMarkdown: false }, ctx());
    expect(mockGetStoreValue).not.toHaveBeenCalled();
    expect(mockAppendAtomic).not.toHaveBeenCalled();
  });
});

describe('whatsapp executor — media', () => {
  it('sends a media path via sendAttachment with the caption', async () => {
    const r = await whatsappExecutor.execute(
      { x: 'update' },
      { to: '+123', mediaPath: '/tmp/report.png', caption: 'Weekly {{input.x}}' },
      ctx(),
    );
    expect(mockSendAttachment).toHaveBeenCalledOnce();
    const [to, att, caption] = mockSendAttachment.mock.calls[0];
    expect(to).toBe('+123');
    expect(att).toMatchObject({ kind: 'image', diskPath: '/tmp/report.png', mimeType: 'image/png' });
    expect(caption).toBe('Weekly update');
    expect(r.output).toMatchObject({ sent: true, media: true, messageId: 'a1' });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('whatsapp executor — a send that did not send is a FAILURE', () => {
  /**
   * The production DB held 12 node_executions reading `Hermes bridge
   * unreachable`, every one of them `node_status=completed,
   * run_status=completed`. Workflows whose entire purpose was to deliver a
   * message were reporting success while delivering nothing.
   */
  it('throws when the bridge is unreachable, carrying the underlying error', async () => {
    mockSendMessage.mockResolvedValue({ sent: false, error: 'Hermes bridge unreachable' });
    await expect(
      whatsappExecutor.execute({}, { to: '+123', message: 'hi', formatMarkdown: false }, ctx()),
    ).rejects.toThrow(/Hermes bridge unreachable/);
  });

  it('names how far it got when a multi-chunk send fails partway', async () => {
    mockSendMessage
      .mockResolvedValueOnce({ sent: true, messageId: 'm1' })
      .mockResolvedValueOnce({ sent: false, error: 'dropped' });
    const long = 'x'.repeat(5000);
    await expect(
      whatsappExecutor.execute({}, { to: '+123', message: long, formatMarkdown: false }, ctx()),
    ).rejects.toThrow(/1\/\d+ chunk/);
  });

  it('still returns normally on a successful send', async () => {
    mockSendMessage.mockResolvedValue({ sent: true, messageId: 'm1' });
    const r = await whatsappExecutor.execute(
      {},
      { to: '+123', message: 'hi', formatMarkdown: false },
      ctx(),
    );
    expect(r.output).toMatchObject({ sent: true, skipped: false, error: null });
  });

  it('does not throw in dryRun even when the underlying send would fail', async () => {
    mockSendMessage.mockResolvedValue({ sent: false, error: 'offline' });
    const r = await whatsappExecutor.execute(
      {},
      { to: '+123', message: 'hi' },
      ctx({ dryRun: true }),
    );
    expect(r.output).toMatchObject({ simulated: true });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
