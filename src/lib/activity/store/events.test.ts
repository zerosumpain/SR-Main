import { describe, expect, it } from 'vitest';
import { activityEventRow } from './events.server';
import type { ActivityEventV1 } from '../contracts';

const event: ActivityEventV1 = {
  id: 'event-1',
  schemaVersion: 1,
  principalId: 'owner',
  connectionId: 'connection-1',
  source: 'apple_music',
  type: 'media.track.recently_seen',
  category: 'music',
  subjectKey: 'owner',
  occurredAt: null,
  observedAt: '2026-09-04T12:00:00.000Z',
  evidenceMode: 'provider_snapshot',
  actor: { providerId: 'account-1' },
  object: { providerId: 'track-1', kind: 'song', label: 'Example' },
  measures: { recent_rank: 1 },
  provenance: { providerObjectId: 'track-1', adapterVersion: 'apple-music-v1' },
};

describe('activityEventRow', () => {
  it('preserves unknown occurrence time instead of substituting sync time', () => {
    const row = activityEventRow(event);
    expect(row.occurredAt).toBeNull();
    expect(row.observedAt).toEqual(new Date('2026-09-04T12:00:00.000Z'));
    expect(row.evidenceMode).toBe('provider_snapshot');
  });
});
