import { describe, expect, it } from 'vitest';
import {
  ActivityContractError,
  validateActivityEvent,
  type ActivityEventV1,
} from './event';

function validEvent(over: Partial<ActivityEventV1> = {}): ActivityEventV1 {
  return {
    id: 'event-1',
    schemaVersion: 1,
    principalId: 'principal-1',
    connectionId: 'connection-1',
    source: 'steam',
    type: 'game.achievement.unlocked',
    category: 'gaming',
    subjectKey: 'principal-1',
    occurredAt: '2026-09-04T09:00:00.000Z',
    observedAt: '2026-09-04T09:01:00.000Z',
    evidenceMode: 'provider_event',
    actor: { providerId: 'player-1' },
    object: { providerId: 'achievement-1', kind: 'achievement', label: 'First step' },
    measures: { points: 10 },
    provenance: {
      providerObjectId: 'achievement-1',
      providerRevision: '1',
      adapterVersion: 'steam-v1',
    },
    ...over,
  };
}

describe('validateActivityEvent', () => {
  it('accepts a valid provider event', () => {
    expect(validateActivityEvent(validEvent())).toEqual(validEvent());
  });

  it('rejects an unsupported schema version', () => {
    const event = { ...validEvent(), schemaVersion: 2 } as unknown as ActivityEventV1;
    expect(() => validateActivityEvent(event)).toThrow(/schemaVersion/);
  });

  it('rejects an event for another principal or connection', () => {
    expect(() =>
      validateActivityEvent(validEvent(), { principalId: 'principal-2' }),
    ).toThrowError(expect.objectContaining({ code: 'principal_mismatch' }));
    expect(() =>
      validateActivityEvent(validEvent(), { connectionId: 'connection-2' }),
    ).toThrowError(expect.objectContaining({ code: 'connection_mismatch' }));
  });

  it('rejects occurrence times beyond the clock-skew allowance', () => {
    expect(() =>
      validateActivityEvent(
        validEvent({ occurredAt: '2026-09-04T10:00:00.000Z' }),
        { maxClockSkewMs: 1_000 },
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid_time' }));
  });

  it('requires snapshots to keep occurrence time and action claims unknown', () => {
    expect(() =>
      validateActivityEvent(
        validEvent({ evidenceMode: 'provider_snapshot' }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'unsupported_claim' }));

    expect(() =>
      validateActivityEvent(
        validEvent({
          evidenceMode: 'provider_snapshot',
          occurredAt: null,
          measures: { played_seconds: 120 },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: 'unsupported_claim' }));
  });

  it('keeps provider prose out of the normalized metadata envelope', () => {
    expect(() => validateActivityEvent(validEvent({ measures: { body: 'private prose' } })))
      .toThrowError(expect.objectContaining({ code: 'raw_content_in_metadata' }));
  });

  it('returns typed contract errors', () => {
    try {
      validateActivityEvent(validEvent({ type: 'Not valid' }));
    } catch (error) {
      expect(error).toBeInstanceOf(ActivityContractError);
      expect((error as ActivityContractError).code).toBe('invalid_event');
    }
  });
});
