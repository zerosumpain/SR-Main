import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/daydream/thought-store', () => ({
  recordFeedback: vi.fn(),
  unmuteKind: vi.fn(),
}));
vi.mock('$lib/daydream/types', () => ({
  errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

import { POST } from './+server';

function actionEvent(body: Record<string, unknown>) {
  return {
    request: new Request('http://local/api/daydream/thoughts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}

describe('daydream thought actions', () => {
  // The backlog moved to /api/jkai/backlog with the board (2026-09-26). A
  // stale client posting here must fail loudly rather than half-work.
  it('no longer accepts backlog actions', async () => {
    const response = await POST(actionEvent({ action: 'backlog_create', title: 'x', priority: 1 }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'unknown action: backlog_create' });
  });
});
