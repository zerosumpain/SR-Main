import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/daydream/ledger', () => ({
  snoozeThought: vi.fn(),
  unmuteKind: vi.fn(),
}));
vi.mock('$lib/daydream/thought-store', () => ({
  loadTriageDeck: vi.fn(),
  recordFeedback: vi.fn(),
  recordTriageBatch: vi.fn(),
}));
vi.mock('$lib/daydream/places', () => ({
  confirmPlace: vi.fn(),
  describePlaceRhythm: vi.fn(),
  ignorePlace: vi.fn(),
  isPlaceKind: vi.fn(),
  listNamingQueue: vi.fn(),
}));
vi.mock('$lib/daydream/types', () => ({
  errMsg: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock('$lib/daydream/hypotheses/store', () => ({
  loadBoard: vi.fn(),
  rateQuestion: vi.fn(),
}));
vi.mock('$lib/daydream/hypotheses/steer', () => ({
  addSteer: vi.fn(),
  listSteers: vi.fn(),
  setSteerStatus: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  budgetStatus: vi.fn(async () => ({ blocked: false, blockedReason: null })),
  resolveDaydreamModel: vi.fn(async () => ({ provider: 'openrouter', modelId: 'test-model' })),
  runMemoryConsolidation: vi.fn(),
}));

vi.mock('$lib/daydream/budget', () => ({ budgetStatus: mocks.budgetStatus }));
vi.mock('$lib/daydream/compose', () => ({ resolveDaydreamModel: mocks.resolveDaydreamModel }));
vi.mock('$lib/daydream/memory-consolidation.server', () => ({ runMemoryConsolidation: mocks.runMemoryConsolidation }));

import { POST } from './+server';

const completed = {
  status: 'completed' as const,
  localDay: '2026-09-02',
  memoriesReviewed: 12,
  themesCreated: 2,
  themesUpdated: 1,
  memoriesLinked: 12,
  ignored: 0,
  model: 'test-model',
  tokens: { prompt: 100, completion: 50 },
  error: null,
};

function event() {
  return {
    request: new Request('http://local/api/daydream/thoughts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'consolidate_memories' }),
    }),
  } as never;
}

describe('interactive memory consolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.budgetStatus.mockResolvedValue({ blocked: false, blockedReason: null });
    mocks.resolveDaydreamModel.mockResolvedValue({ provider: 'openrouter', modelId: 'test-model' });
  });

  it('returns 202 after the durable run starts instead of awaiting the model pass', async () => {
    let finish: ((result: typeof completed) => void) | undefined;
    mocks.runMemoryConsolidation.mockImplementation((options: {
      onStarted: (run: { localDay: string; startedAt: Date }) => void;
    }) => new Promise<typeof completed>((resolve) => {
      finish = resolve;
      options.onStarted({ localDay: completed.localDay, startedAt: new Date('2026-09-02T08:00:00Z') });
    }));

    const response = await POST(event());
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      accepted: true,
      localDay: completed.localDay,
      startedAt: '2026-09-02T08:00:00.000Z',
    });

    finish?.(completed);
    await Promise.resolve();
  });

  it('returns the real startup error when the run cannot be claimed', async () => {
    mocks.runMemoryConsolidation.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(event());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'database unavailable' });
  });
});
