import { describe, expect, it } from 'vitest';
import { validateActivityEvent } from '../../contracts';
import { parseYouTubeTakeoutHistory } from './parse';

const context = {
  principalId: 'owner',
  connectionId: 'connection-1',
  providerId: 'youtube_takeout',
  mode: 'import' as const,
  scopes: [],
  observedAt: '2026-09-04T12:00:00.000Z',
  cursor: null,
};

describe('parseYouTubeTakeoutHistory', () => {
  it('uses an explicit product marker before labelling a record as music', () => {
    const result = parseYouTubeTakeoutHistory({
      context,
      importId: 'import-1',
      value: [
        {
          header: 'YouTube Music',
          title: 'Listened to Example track',
          titleUrl: 'https://www.youtube.com/watch?v=music123',
          subtitles: [{ name: 'Example artist' }],
          time: '2026-09-01T10:00:00.000Z',
          products: ['YouTube Music'],
        },
      ],
    });
    expect(result.musicRecords).toBe(1);
    expect(result.events[0]).toMatchObject({
      type: 'media.track.listened',
      category: 'music',
      evidenceMode: 'archive_import',
      occurredAt: '2026-09-01T10:00:00.000Z',
    });
    expect(() => validateActivityEvent(result.events[0], context)).not.toThrow();
  });

  it('keeps an ambiguous YouTube record generic even when its title says music', () => {
    const result = parseYouTubeTakeoutHistory({
      context,
      importId: 'import-1',
      value: [
        {
          header: 'YouTube',
          title: 'Watched Best music mix',
          titleUrl: 'https://www.youtube.com/watch?v=video123',
          time: '2026-09-01T10:00:00Z',
          products: ['YouTube'],
        },
      ],
    });
    expect(result.events[0]).toMatchObject({ type: 'media.video.watched', category: 'video' });
  });

  it('rejects malformed rows without turning absence into an empty activity claim', () => {
    const result = parseYouTubeTakeoutHistory({
      context,
      importId: 'import-1',
      value: [null, { title: 'Watched something' }, { time: '2026-09-01T10:00:00Z' }],
    });
    expect(result.events).toEqual([]);
    expect(result.rejected).toHaveLength(3);
    expect(result.dateRange).toBeNull();
  });

  it('gives identical archive rows stable ids and preserves duplicate occurrences by ordinal', () => {
    const row = {
      header: 'YouTube',
      title: 'Watched Example',
      titleUrl: 'https://youtu.be/video123',
      time: '2026-09-01T10:00:00Z',
      products: ['YouTube'],
    };
    const first = parseYouTubeTakeoutHistory({ context, importId: 'import-1', value: [row, row] });
    const replay = parseYouTubeTakeoutHistory({ context, importId: 'import-1', value: [row, row] });
    expect(first.events.map((event) => event.id)).toEqual(replay.events.map((event) => event.id));
    expect(first.events[0].id).not.toBe(first.events[1].id);
  });
});
