// The 'build' provider writes the LATEST BUILD STATE block the heartbeat
// prompt (and so the owner's progress message) is built from.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const row = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => {
      const where = () => ({ limit: async () => (row.current ? [row.current] : []) });
      return { from: () => ({ where, innerJoin: () => ({ where }) }) };
    },
  },
}));

import { getTaskStateProvider } from './state-providers';

const build = (publishedSlug: string | null) => ({
  id: 'b1',
  status: 'completed',
  iterationsCompleted: 3,
  activeMinutesUsed: 4,
  costUsd: '0.12',
  consecutiveFailures: 0,
  updatedAt: '2026-10-28T10:00:00Z',
  failure: null,
  publishedSlug,
});

async function published(slug: string | null): Promise<string | undefined> {
  row.current = build(slug);
  const snap = await getTaskStateProvider('build')!('b1');
  return snap?.contextBlock.split('\n').find((l) => l.trim().startsWith('published:'))?.split('published:')[1].trim();
}

describe('build state provider', () => {
  beforeEach(() => {
    row.current = null;
  });

  // A change-request build stores its PR URL in published_slug; the provider
  // used to print it as `/https://github.com/…`.
  it('prints a PR URL as it is, without a leading slash', async () => {
    expect(await published('https://github.com/zerosumpain/SR-Main/pull/416')).toBe(
      'https://github.com/zerosumpain/SR-Main/pull/416',
    );
  });

  it('prints an app build as its /projects address', async () => {
    expect(await published('stopwatch')).toBe('/projects/stopwatch/');
  });

  it('prints a compare ref as text, not as a path', async () => {
    expect(await published('master...agent/ab2-a15e73d3')).toBe('master...agent/ab2-a15e73d3');
  });

  it('omits the line when nothing is published', async () => {
    expect(await published(null)).toBeUndefined();
  });

  it('marks a completed build terminal', async () => {
    row.current = build(null);
    expect((await getTaskStateProvider('build')!('b1'))?.terminal).toBe(true);
  });
});

describe('delivery state provider (a commissioned build)', () => {
  const delivery = (over: Record<string, unknown> = {}) => ({
    title: 'Add X',
    outcome: null,
    costUsd: '0.40',
    status: 'paused',
    state: {
      version: 1, area: 'Platform', stage: 'building',
      brief: { revision: 1, outcome: 'x', constraints: '', routes: [], acceptedAt: 'a' },
      criteria: [{ id: 'c1', text: 'a', verdict: 'passed', evidence: 'seen', revision: 'r1' }, { id: 'c2', text: 'b', verdict: 'unverified', evidence: '', revision: null }],
      decisions: [], session: { engine: 'pi', id: null, file: null, recovery: null },
      candidate: 'r1', gate: null, preview: { url: null, status: 'unavailable', detail: '' },
      batch: null, acceptedAt: null, releasePolicy: 'pull_request',
      ...over,
    },
  });
  const snap = async (over: Record<string, unknown> = {}, outcome: string | null = null) => {
    row.current = { ...delivery(over), outcome };
    return getTaskStateProvider('delivery')!('b1');
  };

  it('is registered, so develop_commission gets a watcher', () => {
    expect(getTaskStateProvider('delivery')).not.toBeNull();
  });

  it('runs while building, and its one line names the stage and criteria', async () => {
    const s = await snap();
    expect(s?.terminal).toBe(false);
    expect(s?.summary).toBe('Building · 1 of 2 criteria met');
    expect(s?.contextBlock).toContain('/jkai/develop/b1');
  });

  it('is terminal at pr_open with the preview and PR URLs in the snapshot', async () => {
    const s = await snap({ stage: 'pr_open', preview: { url: 'https://preview.example', status: 'ready', detail: '' }, release: { revision: 'r1', prUrl: 'https://github.com/x/pull/9' } });
    expect(s?.terminal).toBe(true);
    expect(s?.summary).toContain('https://preview.example');
    expect(s?.summary).toContain('https://github.com/x/pull/9');
    expect(s?.contextBlock).toContain('pull request:  https://github.com/x/pull/9');
  });

  it('is terminal when deployed, waiting on the owner, or stopped', async () => {
    expect((await snap({ stage: 'deployed' }))?.terminal).toBe(true);
    expect((await snap({ release: { revision: 'r1', awaitingOwner: 'Mark the draft ready' } }))?.summary).toContain('waiting on you: Mark the draft ready');
    expect((await snap({ release: { revision: 'r1', awaitingOwner: 'x' } }))?.terminal).toBe(true);
    expect((await snap({ autopilot: { enabled: true, rounds: 6, maxRounds: 6, startedAt: 's', stopReason: 'Out of rounds' } }))?.terminal).toBe(true);
    expect((await snap({}, 'stopped_by_user'))?.terminal).toBe(true);
  });

  it('keeps cost out of the line, so a tick with only new spend posts nothing', async () => {
    const a = (await snap())?.summary;
    row.current = { ...delivery(), costUsd: '1.90', outcome: null };
    expect((await getTaskStateProvider('delivery')!('b1'))?.summary).toBe(a);
  });
});
