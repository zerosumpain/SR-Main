import { describe, it, expect, vi, beforeEach } from 'vitest';

// The workflow row the mocked db returns for the current test.
let currentRow: Record<string, unknown> | undefined;

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(currentRow === undefined ? [] : [currentRow]),
        }),
      }),
    }),
  },
}));

const sendMessage = vi.fn(
  async (
    _to: string,
    _text: string,
  ): Promise<{ sent: boolean; messageId?: string; error?: string }> => ({
    sent: true,
    messageId: 'm1',
  }),
);
vi.mock('$lib/workflows/whatsapp/service', () => ({
  getWhatsAppService: () => ({ sendMessage }),
}));

import { notifyRunOutcome } from './run-notifications';

beforeEach(() => {
  currentRow = undefined;
  sendMessage.mockClear();
  sendMessage.mockResolvedValue({ sent: true, messageId: 'm1' });
});

const CANVAS_ROW = (notifications: unknown) => ({
  name: 'canvas:news-pipeline',
  description: 'News Pipeline',
  notifications,
});

describe('notifyRunOutcome — silent defaults', () => {
  it('sends nothing when the workflow has no notifications config (null)', async () => {
    currentRow = CANVAS_ROW(null);
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends nothing when the row is missing entirely', async () => {
    currentRow = undefined;
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends nothing for an empty config object', async () => {
    currentRow = CANVAS_ROW({});
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'completed' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends nothing for a non-terminal status even when opted in', async () => {
    currentRow = CANVAS_ROW({ onFailure: true, onCompletion: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'awaiting_human' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not send a completion ping when only onFailure is set', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'completed' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ignores a non-whatsapp channel (only whatsapp is wired)', async () => {
    currentRow = CANVAS_ROW({ onFailure: true, channel: 'email' });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('notifyRunOutcome — failure alerts', () => {
  it('sends a failure alert with the canvas name + URL', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'tavily 500' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = sendMessage.mock.calls[0];
    expect(text).toContain('⚠ Workflow News Pipeline failed');
    expect(text).toContain('tavily 500');
    expect(text).toContain('https://strangeramblings.com/jkai/canvas/news-pipeline');
  });

  it('truncates a long error to <= 300 chars with an ellipsis', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    const longError = 'x'.repeat(400);
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: longError });
    const [, text] = sendMessage.mock.calls[0];
    // The error segment sits between "failed: " and " — http"; assert it's capped.
    const seg = text.split('failed: ')[1].split(' — http')[0];
    expect(seg.length).toBeLessThanOrEqual(300);
    expect(seg.endsWith('…')).toBe(true);
    expect(text).not.toContain('x'.repeat(400));
  });

  it('fires onFailure for completed_with_errors', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'completed_with_errors' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = sendMessage.mock.calls[0];
    expect(text).toContain('completed with errors');
  });

  it('falls back to a generic error when none is supplied', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed' });
    const [, text] = sendMessage.mock.calls[0];
    expect(text).toContain('run failed');
  });
});

describe('notifyRunOutcome — completion digests', () => {
  it('sends a bare completion message when no digestField is set', async () => {
    currentRow = CANVAS_ROW({ onCompletion: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'completed' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, text] = sendMessage.mock.calls[0];
    expect(text).toContain('✓ News Pipeline completed');
    expect(text).toContain('https://strangeramblings.com/jkai/canvas/news-pipeline');
  });

  it('appends the digestField value from terminal outputs', async () => {
    currentRow = CANVAS_ROW({ onCompletion: true, digestField: 'summary' });
    await notifyRunOutcome({
      workflowId: 'wf1',
      runId: 'r1',
      status: 'completed',
      terminalOutputs: { summary: '3 new stories delivered' },
    });
    const [, text] = sendMessage.mock.calls[0];
    expect(text).toContain('✓ News Pipeline completed');
    expect(text).toContain('3 new stories delivered');
  });

  it('resolves a dot-path digestField', async () => {
    currentRow = CANVAS_ROW({ onCompletion: true, digestField: 'result.text' });
    await notifyRunOutcome({
      workflowId: 'wf1',
      runId: 'r1',
      status: 'completed',
      terminalOutputs: { result: { text: 'nested digest' } },
    });
    const [, text] = sendMessage.mock.calls[0];
    expect(text).toContain('nested digest');
  });

  it('truncates a long digest value to <= 500 chars', async () => {
    currentRow = CANVAS_ROW({ onCompletion: true, digestField: 'summary' });
    await notifyRunOutcome({
      workflowId: 'wf1',
      runId: 'r1',
      status: 'completed',
      terminalOutputs: { summary: 'y'.repeat(700) },
    });
    const [, text] = sendMessage.mock.calls[0];
    const digestPortion = text.split('completed\n\n')[1].split('\n\nhttps://')[0];
    expect(digestPortion.length).toBeLessThanOrEqual(500);
    expect(digestPortion.endsWith('…')).toBe(true);
  });
});

describe('notifyRunOutcome — never throws', () => {
  it('swallows a throwing WhatsApp service and does not reject', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    sendMessage.mockRejectedValueOnce(new Error('bridge unreachable'));
    await expect(
      notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' }),
    ).resolves.toBeUndefined();
  });

  it('swallows a {sent:false} result without throwing', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    sendMessage.mockResolvedValueOnce({ sent: false, error: 'not connected' });
    await expect(
      notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' }),
    ).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalled();
  });
});
