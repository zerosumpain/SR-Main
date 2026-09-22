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

// The seam under test is the NOTIFIER, not WhatsApp.
//
// This file used to mock `whatsapp/service` and assert on the composed message
// string, which made the channel part of the contract: routing a workflow ping
// to the phone instead would have been a red test rather than a preference. It
// now asserts the payload handed to `notifyOwner` — who is told, in what
// category, with what title and body — and where that goes is the routing
// table's business.
// Declared WITH its parameter. A zero-argument `vi.fn` types `mock.calls` as
// an array of empty tuples, and `calls[0][0]` is then a compile error rather
// than the payload — "Tuple type '[]' of length '0' has no element at index 0".
const notifyOwner = vi.fn(async (_input: { category: string }) => ({ raised: true, id: 'n1' }));
vi.mock('$lib/server/notify', () => ({ notifyOwner }));

import { notifyRunOutcome } from './run-notifications';

beforeEach(() => {
  currentRow = undefined;
  notifyOwner.mockClear();
  notifyOwner.mockResolvedValue({ raised: true, id: 'n1' });
});

const CANVAS_ROW = (notifications: unknown) => ({
  name: 'canvas:news-pipeline',
  description: 'News Pipeline',
  notifications,
});

/** The single call's payload. */
function payload() {
  expect(notifyOwner).toHaveBeenCalledTimes(1);
  return notifyOwner.mock.calls[0]![0] as unknown as {
    category: string;
    title: string;
    body: string;
    url: string;
    severity: string;
  };
}

describe('notifyRunOutcome — silent defaults', () => {
  it('sends nothing when the workflow has no notifications config (null)', async () => {
    currentRow = CANVAS_ROW(null);
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' });
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it('sends nothing when the row is missing entirely', async () => {
    currentRow = undefined;
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' });
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it('sends nothing for an empty config object', async () => {
    currentRow = CANVAS_ROW({});
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'completed' });
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it('sends nothing for a non-terminal status even when opted in', async () => {
    currentRow = CANVAS_ROW({ onFailure: true, onCompletion: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'awaiting_human' });
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it('does not send a completion ping when only onFailure is set', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'completed' });
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it('ignores a channel the config names explicitly and is not whatsapp', async () => {
    currentRow = CANVAS_ROW({ onFailure: true, channel: 'email' });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' });
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it('skips a child run so a fan-out does not notify N times', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'sub-r1', status: 'failed', error: 'boom' });
    expect(notifyOwner).not.toHaveBeenCalled();
  });
});

describe('notifyRunOutcome — failure alerts', () => {
  it('raises a build-category failure with the canvas name and URL', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'tavily 500' });
    const sent = payload();
    expect(sent.category).toBe('build');
    expect(sent.severity).toBe('warn');
    expect(sent.title).toContain('News Pipeline failed');
    expect(sent.body).toContain('tavily 500');
    expect(sent.url).toBe('https://strangeramblings.com/jkai/canvas/news-pipeline');
  });

  it('truncates a long error to <= 300 chars with an ellipsis', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'x'.repeat(400) });
    const sent = payload();
    expect(sent.body.length).toBeLessThanOrEqual(300);
    expect(sent.body.endsWith('…')).toBe(true);
  });

  it('fires onFailure for completed_with_errors', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'completed_with_errors' });
    expect(payload().body).toContain('completed with errors');
  });

  it('falls back to a generic error when none is supplied', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed' });
    expect(payload().body).toContain('run failed');
  });
});

describe('notifyRunOutcome — completion digests', () => {
  it('raises a bare completion when no digestField is set', async () => {
    currentRow = CANVAS_ROW({ onCompletion: true });
    await notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'completed' });
    const sent = payload();
    expect(sent.title).toContain('News Pipeline completed');
    expect(sent.severity).toBe('info');
    expect(sent.url).toBe('https://strangeramblings.com/jkai/canvas/news-pipeline');
  });

  it('uses the digestField value from terminal outputs as the body', async () => {
    currentRow = CANVAS_ROW({ onCompletion: true, digestField: 'summary' });
    await notifyRunOutcome({
      workflowId: 'wf1',
      runId: 'r1',
      status: 'completed',
      terminalOutputs: { summary: '3 new stories delivered' },
    });
    const sent = payload();
    expect(sent.title).toContain('News Pipeline completed');
    expect(sent.body).toContain('3 new stories delivered');
  });

  it('resolves a dot-path digestField', async () => {
    currentRow = CANVAS_ROW({ onCompletion: true, digestField: 'result.text' });
    await notifyRunOutcome({
      workflowId: 'wf1',
      runId: 'r1',
      status: 'completed',
      terminalOutputs: { result: { text: 'nested digest' } },
    });
    expect(payload().body).toContain('nested digest');
  });

  it('truncates a long digest value to <= 500 chars', async () => {
    currentRow = CANVAS_ROW({ onCompletion: true, digestField: 'summary' });
    await notifyRunOutcome({
      workflowId: 'wf1',
      runId: 'r1',
      status: 'completed',
      terminalOutputs: { summary: 'y'.repeat(700) },
    });
    const sent = payload();
    expect(sent.body.length).toBeLessThanOrEqual(500);
    expect(sent.body.endsWith('…')).toBe(true);
  });
});

describe('notifyRunOutcome — never throws', () => {
  it('swallows a throwing notifier and does not reject', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    notifyOwner.mockRejectedValueOnce(new Error('database unreachable'));
    await expect(
      notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' }),
    ).resolves.toBeUndefined();
  });

  it('swallows a raised:false result without throwing', async () => {
    currentRow = CANVAS_ROW({ onFailure: true });
    notifyOwner.mockResolvedValueOnce({ raised: false, reason: 'throttled' } as never);
    await expect(
      notifyRunOutcome({ workflowId: 'wf1', runId: 'r1', status: 'failed', error: 'boom' }),
    ).resolves.toBeUndefined();
    expect(notifyOwner).toHaveBeenCalled();
  });
});
