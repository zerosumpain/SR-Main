import { describe, expect, it } from 'vitest';
import { validateActivityEvent } from '../../contracts';
import { normaliseAppleMusicRecent } from './normalise';

const context = {
  principalId: 'owner',
  connectionId: 'connection-1',
  providerId: 'apple_music',
  providerAccountId: 'apple-user',
  mode: 'oauth' as const,
  scopes: ['music_user_token'],
  observedAt: '2026-09-04T12:00:00.000Z',
  cursor: null,
};

const resources = [
  {
    id: 'track-1',
    type: 'songs',
    attributes: {
      name: 'Example song',
      artistName: 'Example artist',
      albumName: 'Example album',
      durationInMillis: 183_000,
      url: 'https://music.apple.com/gb/song/example/1',
    },
  },
];

describe('normaliseAppleMusicRecent', () => {
  it('preserves a recent item as untimestamped snapshot evidence', () => {
    const result = normaliseAppleMusicRecent({ context, resources });
    expect(result.events[0]).toMatchObject({
      type: 'media.track.recently_seen',
      occurredAt: null,
      observedAt: context.observedAt,
      evidenceMode: 'provider_snapshot',
      measures: { recent_rank: 1, catalog_duration_ms: 183_000 },
    });
    expect(result.events[0].measures).not.toHaveProperty('played_seconds');
    expect(() => validateActivityEvent(result.events[0], context)).not.toThrow();
  });

  it('does not manufacture another play while an item remains in the recent list', () => {
    const first = normaliseAppleMusicRecent({ context, resources });
    const second = normaliseAppleMusicRecent({
      context: { ...context, observedAt: '2026-09-04T13:00:00.000Z' },
      resources,
      previous: first.cursor,
    });
    expect(second.events).toEqual([]);
    expect(second.cursor.generation).toBe(first.cursor.generation);
  });

  it('emits snapshot evidence again only after an item leaves and returns', () => {
    const first = normaliseAppleMusicRecent({ context, resources });
    const empty = normaliseAppleMusicRecent({
      context: { ...context, observedAt: '2026-09-04T13:00:00.000Z' },
      resources: [],
      previous: first.cursor,
    });
    const returned = normaliseAppleMusicRecent({
      context: { ...context, observedAt: '2026-09-04T14:00:00.000Z' },
      resources,
      previous: empty.cursor,
    });
    expect(returned.events).toHaveLength(1);
    expect(returned.events[0].id).not.toBe(first.events[0].id);
  });

  it('deduplicates repeated catalogue resources in one response', () => {
    const result = normaliseAppleMusicRecent({ context, resources: [...resources, ...resources] });
    expect(result.events).toHaveLength(1);
  });
});
