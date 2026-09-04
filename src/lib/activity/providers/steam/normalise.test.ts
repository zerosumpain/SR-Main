import { describe, expect, it } from 'vitest';
import { validateActivityEvent } from '../../contracts';
import { normaliseSteamSnapshot, type SteamCursor } from './normalise';

const context = {
  principalId: 'owner',
  connectionId: 'connection-1',
  providerId: 'steam',
  providerAccountId: '76561198000000000',
  mode: 'openid' as const,
  scopes: [],
  observedAt: '2026-09-04T12:00:00.000Z',
  cursor: null,
};

describe('normaliseSteamSnapshot', () => {
  it('records first sight as a snapshot without inventing a session', () => {
    const result = normaliseSteamSnapshot({
      context,
      games: [{ appid: 10, name: 'Example', playtime_forever: 120, rtime_last_played: 1_788_523_000 }],
      achievements: [],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'game.library.observed',
      evidenceMode: 'provider_snapshot',
      occurredAt: null,
    });
    expect(() => validateActivityEvent(result.events[0], context)).not.toThrow();
  });

  it('emits a delta, not an exact session, when cumulative playtime increases', () => {
    const previous: SteamCursor = {
      observedAt: '2026-09-03T12:00:00.000Z',
      games: { '10': { playtimeForever: 120, lastPlayedAt: 1_788_523_000 } },
      achievements: {},
    };
    const result = normaliseSteamSnapshot({
      context,
      previous,
      games: [{ appid: 10, name: 'Example', playtime_forever: 165, rtime_last_played: 1_788_609_400 }],
      achievements: [],
    });
    const delta = result.events.find((event) => event.type === 'game.playtime.changed');
    expect(delta).toMatchObject({ evidenceMode: 'inferred_delta', measures: { delta_minutes: 45 } });
    expect(delta?.measures).not.toHaveProperty('session_minutes');
  });

  it('does not emit negative activity when Steam corrects a total downward', () => {
    const result = normaliseSteamSnapshot({
      context,
      previous: {
        observedAt: '2026-09-03T12:00:00.000Z',
        games: { '10': { playtimeForever: 200, lastPlayedAt: 0 } },
        achievements: {},
      },
      games: [{ appid: 10, playtime_forever: 100 }],
      achievements: [],
    });
    expect(result.events.some((event) => event.type === 'game.playtime.changed')).toBe(false);
    expect(result.warnings[0]).toContain('decreased');
  });

  it('backfills timestamped achievements idempotently from the cursor', () => {
    const achievement = { apiname: 'FIRST', achieved: 1, unlocktime: 1_788_523_000, name: 'First' };
    const first = normaliseSteamSnapshot({
      context,
      games: [],
      achievements: [{ appid: 10, values: [achievement] }],
    });
    expect(first.events[0]).toMatchObject({
      type: 'game.achievement.unlocked',
      evidenceMode: 'provider_event',
    });
    const second = normaliseSteamSnapshot({
      context,
      previous: first.cursor,
      games: [],
      achievements: [{ appid: 10, values: [achievement] }],
    });
    expect(second.events).toEqual([]);
  });
});
