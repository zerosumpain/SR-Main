// The 'build' provider writes the LATEST BUILD STATE block the heartbeat
// prompt (and so the owner's progress message) is built from.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const row = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row.current ? [row.current] : []) }) }) }),
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
