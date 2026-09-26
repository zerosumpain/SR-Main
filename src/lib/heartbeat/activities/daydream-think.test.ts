import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ThinkRow } from '$lib/daydream/think/notes';

const h = vi.hoisted(() => ({
  rows: [] as ThinkRow[],
  keysAsked: [] as string[][],
  intake: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/daydream/think/notes.server', () => ({
  loadThinkRowsByKeys: vi.fn(async (keys: string[]) => {
    h.keysAsked.push(keys);
    return h.rows;
  }),
}));
vi.mock('$lib/selfimprove/backlog', () => ({
  intakeIdeas: vi.fn(async (ideas: Array<Record<string, unknown>>) => {
    h.intake.push(...ideas);
    return { added: ['a'], merged: [], capped: 0, outcomes: ideas.map(() => 'added') };
  }),
}));
// The activity module's other imports reach the database and the model
// gateway at load time; none of them is exercised by `queueBuildNotes`.
vi.mock('$lib/server/models/settings', () => ({ getSetting: vi.fn() }));
vi.mock('$lib/heartbeat/idle', () => ({ isUserActive: vi.fn() }));
vi.mock('$lib/workflows/chat/activity', () => ({ listChatJobs: vi.fn() }));
vi.mock('$lib/daydream/budget', () => ({ attributeSpend: vi.fn(), budgetStatus: vi.fn(), readQuotaMark: vi.fn(), ZERO_SPEND: {} }));
vi.mock('$lib/daydream/model', () => ({ resolveDaydreamModel: vi.fn() }));
vi.mock('$lib/daydream/think/run', () => ({ runThink: vi.fn(), MAX_ROUNDS: 6 }));

import { queueBuildNotes } from './daydream-think';

function row(over: Partial<ThinkRow>): ThinkRow {
  return {
    id: 'n1',
    kind: 'think_build',
    title: 'A rail delay card on Today',
    narrative: 'Three late trains this week.',
    explanation: 'Read 2 cards',
    evidence: [],
    status: 'delivered',
    suppressedReason: null,
    feedback: null,
    createdAt: new Date(),
    deliveredAt: new Date(),
    note: null,
    ...over,
  };
}

beforeEach(() => {
  h.rows = [];
  h.keysAsked = [];
  h.intake = [];
});

describe('queueBuildNotes — think build notes reach the one backlog', () => {
  it('queues each new build note as a feature from the think channel, citing the note', async () => {
    h.rows = [row({ id: 'n1' }), row({ id: 'n2', kind: 'think_correlate', title: 'Not a build' })];

    const res = await queueBuildNotes(['think:build:a', 'think:correlate:b']);

    expect(h.keysAsked).toEqual([['think:build:a', 'think:correlate:b']]);
    expect(h.intake).toEqual([
      expect.objectContaining({ title: 'A rail delay card on Today', kind: 'feature', source: 'think', ref: 'thought:n1' }),
    ]);
    expect(res).toEqual({ added: 1, merged: 0 });
  });

  it('does not touch the backlog when the cycle created nothing', async () => {
    expect(await queueBuildNotes([])).toEqual({ added: 0, merged: 0 });
    expect(h.keysAsked).toEqual([]);
    expect(h.intake).toEqual([]);
  });

  it('leaves out a build note held back as an echo of a refuted claim', async () => {
    h.rows = [row({ status: 'suppressed', suppressedReason: 'already_refuted (x)' })];
    expect(await queueBuildNotes(['k'])).toEqual({ added: 0, merged: 0 });
    expect(h.intake).toEqual([]);
  });
});
