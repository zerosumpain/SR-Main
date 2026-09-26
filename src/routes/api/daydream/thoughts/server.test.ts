import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/daydream/thought-store', () => ({
  recordFeedback: vi.fn(),
  unmuteKind: vi.fn(),
}));
vi.mock('$lib/daydream/types', () => ({
  errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

const mocks = vi.hoisted(() => ({
  createBacklogItem: vi.fn(),
  updateBacklogItem: vi.fn(),
  removeBacklogItem: vi.fn(),
  groomBacklogDraft: vi.fn(),
}));

vi.mock('$lib/selfimprove/backlog', () => ({
  createBacklogItem: mocks.createBacklogItem,
  updateBacklogItem: mocks.updateBacklogItem,
  removeBacklogItem: mocks.removeBacklogItem,
}));
vi.mock('$lib/selfimprove/grooming.server', () => ({
  groomBacklogDraft: mocks.groomBacklogDraft,
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

describe('backlog feature management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBacklogItem.mockResolvedValue({ slug: 'owner-feature' });
    mocks.updateBacklogItem.mockResolvedValue({ slug: 'owner-feature' });
    mocks.removeBacklogItem.mockResolvedValue({ slug: 'owner-feature' });
    mocks.groomBacklogDraft.mockResolvedValue({
      assistantMessage: 'I drafted a clear contract.',
      suggestions: { title: 'Owner feature', detail: 'Clearer', kind: 'feature', priority: 2 },
      grooming: { readiness: { score: 88, status: 'ready' } },
      model: 'default-test-model',
    });
  });

  it('creates an owner-authored feature with the editable fields', async () => {
    const response = await POST(actionEvent({
      action: 'backlog_create',
      title: 'Owner feature',
      detail: 'A detailed definition of done',
      kind: 'feature',
      priority: 1,
    }));
    expect(response.status).toBe(200);
    expect(mocks.createBacklogItem).toHaveBeenCalledWith({
      title: 'Owner feature',
      detail: 'A detailed definition of done',
      kind: 'feature',
      priority: 1,
    });
    await expect(response.json()).resolves.toEqual({ ok: true, slug: 'owner-feature' });
  });

  it('updates by stable slug and rejects an incomplete edit', async () => {
    const response = await POST(actionEvent({
      action: 'backlog_update',
      slug: 'owner-feature',
      title: 'Clearer title',
      detail: 'Clearer brief',
      kind: 'tool',
      priority: 2,
    }));
    expect(response.status).toBe(200);
    expect(mocks.updateBacklogItem).toHaveBeenCalledWith('owner-feature', {
      title: 'Clearer title', detail: 'Clearer brief', kind: 'tool', priority: 2,
    });

    const invalid = await POST(actionEvent({ action: 'backlog_update', slug: 'owner-feature' }));
    expect(invalid.status).toBe(400);
    expect(mocks.updateBacklogItem).toHaveBeenCalledTimes(1);
  });

  it('removes a feature through the tombstone write', async () => {
    const response = await POST(actionEvent({ action: 'backlog_remove', slug: 'owner-feature' }));
    expect(response.status).toBe(200);
    expect(mocks.removeBacklogItem).toHaveBeenCalledWith('owner-feature');
    await expect(response.json()).resolves.toEqual({ ok: true, slug: 'owner-feature' });
  });

  it('grooms with a read-only model pass and returns the proposal for review', async () => {
    const response = await POST(actionEvent({
      action: 'backlog_groom',
      slug: 'owner-feature',
      title: 'Owner feature',
      detail: 'rough idea',
      kind: 'feature',
      priority: 2,
      message: 'Make the acceptance criteria testable.',
      conversation: [{ role: 'assistant', content: 'What matters most?' }],
    }));
    expect(response.status).toBe(200);
    expect(mocks.groomBacklogDraft).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'owner-feature',
      message: 'Make the acceptance criteria testable.',
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      model: 'default-test-model',
      grooming: { readiness: { status: 'ready' } },
    });
  });
});
