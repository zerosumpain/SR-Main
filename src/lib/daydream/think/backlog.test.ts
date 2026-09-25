import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ added: [] as unknown[][], throws: false }));

vi.mock('$lib/selfimprove/backlog', () => ({
  addIdeas: vi.fn(async (ideas: unknown[]) => {
    if (h.throws) throw new Error('datastore down');
    h.added.push(ideas);
    return ideas.map((_, i) => `slug-${i}`);
  }),
}));

import { BUILD_NOTE_KIND, buildIdeaFor, queueBuildNotes } from './backlog';

const row = (over: Partial<{ id: string; kind: string; title: string; narrative: string | null }> = {}) => ({
  id: 't1',
  kind: BUILD_NOTE_KIND,
  title: 'A weekly view of heating against sleep',
  narrative: 'The house runs warm on the nights he sleeps worst.\n\nNext: build a chart.',
  ...over,
});

beforeEach(() => {
  h.added = [];
  h.throws = false;
});

describe('buildIdeaFor', () => {
  it('is a feature-kind idea from the daydream channel carrying title, body and a link to the note', () => {
    const idea = buildIdeaFor(row());
    expect(idea.kind).toBe('feature');
    expect(idea.source).toBe('daydream');
    expect(idea.title).toBe('A weekly view of heating against sleep');
    expect(idea.detail).toContain('The house runs warm on the nights he sleeps worst.');
    expect(idea.detail).toContain('/jkai/daydreams?note=t1');
  });

  it('keeps the link when the body is long enough to hit the detail cap', () => {
    const idea = buildIdeaFor(row({ narrative: 'x'.repeat(5000) }));
    expect(idea.detail.length).toBeLessThanOrEqual(2000);
    expect(idea.detail.endsWith('/jkai/daydreams?note=t1')).toBe(true);
  });

  it('falls back to the title when a note has no narrative', () => {
    expect(buildIdeaFor(row({ narrative: null })).detail).toMatch(/^A weekly view of heating against sleep/);
  });
});

describe('queueBuildNotes', () => {
  it('queues build notes and nothing else', async () => {
    const slugs = await queueBuildNotes([row(), row({ id: 't2', kind: 'think_money_analysis' })]);
    expect(h.added).toHaveLength(1);
    expect(h.added[0]).toHaveLength(1);
    expect(slugs).toEqual(['slug-0']);
  });

  it('does not call the backlog at all when no note is a build', async () => {
    expect(await queueBuildNotes([row({ kind: 'think_correlate' })])).toEqual([]);
    expect(h.added).toHaveLength(0);
  });

  it('is soft: a backlog failure never fails the cycle', async () => {
    h.throws = true;
    expect(await queueBuildNotes([row()])).toEqual([]);
  });
});
