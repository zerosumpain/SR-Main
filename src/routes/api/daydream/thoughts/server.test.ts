import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/daydream/thought-store', () => ({
  recordFeedback: vi.fn(),
  unmuteKind: vi.fn(),
}));
vi.mock('$lib/daydream/think/notes.server', () => ({
  fileStale: vi.fn(async (ids: string[] | 'all') => (ids === 'all' ? 3 : 1)),
  keepCurrent: vi.fn(async (id: string) => (id === 'missing' ? null : '2026-10-25')),
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

  it('files one stale note, or all of them, and refuses neither', async () => {
    const one = await POST(actionEvent({ action: 'file_stale', thoughtId: 't1' }));
    await expect(one.json()).resolves.toEqual({ ok: true, filed: 1 });
    const all = await POST(actionEvent({ action: 'file_stale', all: true }));
    await expect(all.json()).resolves.toEqual({ ok: true, filed: 3 });
    expect((await POST(actionEvent({ action: 'file_stale' }))).status).toBe(400);
  });

  it('keeps a note current, and 404s an id that is not a note', async () => {
    const kept = await POST(actionEvent({ action: 'keep_current', thoughtId: 't1' }));
    await expect(kept.json()).resolves.toEqual({ ok: true, until: '2026-10-25' });
    expect((await POST(actionEvent({ action: 'keep_current', thoughtId: 'missing' }))).status).toBe(404);
  });
});
