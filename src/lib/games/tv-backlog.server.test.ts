import { describe, expect, it } from 'vitest';
import type { BacklogRecord } from '$lib/family/backlog';
import { TV_BACKLOG_MAX, tvBacklogItems } from './tv-backlog.server';

function item(over: Partial<BacklogRecord> = {}): BacklogRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'video',
    url: 'https://www.tiktok.com/@a/video/1',
    canonicalUrl: null,
    provider: 'tiktok',
    title: 'A dog on a skateboard',
    siteName: 'TikTok',
    thumbnailUrl: 'https://example.com/t.jpg',
    note: 'for the kids',
    forEmail: 'kid@example.com',
    addedByEmail: 'Mum@Example.com',
    status: 'new',
    doneByEmail: null,
    doneAt: null,
    taskId: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...over,
  };
}

const names = new Map([['mum@example.com', 'Mum']]);

describe('tvBacklogItems', () => {
  it('lists only playable videos still on the list, newest first', () => {
    const out = tvBacklogItems(
      [
        item({ id: 'old', createdAt: new Date('2026-10-01T00:00:00Z') }),
        item({ id: 'new', createdAt: new Date('2026-11-02T00:00:00Z'), provider: 'youtube' }),
        item({ id: 'page', kind: 'page', provider: 'web' }),
        item({ id: 'idea', kind: 'idea', url: null, provider: null }),
        item({ id: 'done', status: 'done' }),
      ],
      names,
    );
    expect(out.map((i) => i.id)).toEqual(['new', 'old']);
    expect(out[0].provider).toBe('YouTube');
  });

  it('names the sharer by first name and never sends an email address or note', () => {
    const [one] = tvBacklogItems([item()], names);
    expect(one.sharedBy).toBe('Mum');
    expect(JSON.stringify(one)).not.toMatch(/@|for the kids/);
    expect(tvBacklogItems([item({ addedByEmail: 'stranger@example.com' })], names)[0].sharedBy).toBeNull();
  });

  it('falls back to a plain title and keeps an evening’s worth', () => {
    expect(tvBacklogItems([item({ title: ' ', siteName: null })], names)[0].title).toBe('A TikTok video');
    const many = Array.from({ length: TV_BACKLOG_MAX + 5 }, (_, i) => item({ id: `i${i}` }));
    expect(tvBacklogItems(many, names)).toHaveLength(TV_BACKLOG_MAX);
  });
});
