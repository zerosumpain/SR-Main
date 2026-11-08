import { describe, expect, it } from 'vitest';
import {
  OFFLINE_BATCH_MAX,
  offlineBoardTitle,
  offlineSlug,
  parseOfflineBatch,
  parseOfflineResult,
} from './offline-results';

const NOW = Date.parse('2026-10-27T18:00:00Z');

/** A row exactly as SRAppleApp's `OfflineResultUpload` encodes it. */
function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '0a1b2c3d-2',
    game: 'offline:blackjack',
    source: 'offline',
    title: 'Blackjack',
    mode: 'nearby',
    finishedAt: NOW - 60_000,
    players: 3,
    bots: 0,
    rank: 1,
    score: 140,
    won: true,
    detail: '3 blackjacks',
    opponents: ['Mum', 'Sam'],
    ...over,
  };
}

function ok(over: Record<string, unknown> = {}) {
  const parsed = parseOfflineResult(wire(over), NOW);
  if (!parsed.ok) throw new Error('expected the row to parse');
  return parsed.row;
}

describe('offline game ids', () => {
  it('takes any safe slug under offline:', () => {
    expect(offlineSlug('offline:maths-sprint')).toBe('maths-sprint');
    expect(offlineSlug('offline:car-race')).toBe('car-race');
    expect(offlineSlug('offline:lander')).toBe('lander');
  });

  it('refuses an online id, an empty slug and anything not a slug', () => {
    for (const bad of [
      'maths-sprint',
      'offline:',
      'offline:Blackjack',
      'offline:-x',
      'offline:x-',
      'offline:a--b',
      'offline:a b',
      'offline:../x',
      `offline:${'a'.repeat(49)}`,
      42,
      null,
    ]) {
      expect(offlineSlug(bad)).toBeNull();
    }
  });
});

describe('parseOfflineResult', () => {
  it('files the phone row as one game_results row', () => {
    expect(ok()).toEqual({
      id: '0a1b2c3d-2',
      game: 'offline:blackjack',
      roomId: 'offline-0a1b2c3d-2',
      score: 140,
      rank: 1,
      won: true,
      players: 3,
      options: {
        source: 'offline',
        bots: 0,
        mode: 'nearby',
        title: 'Blackjack',
        label: '3 blackjacks',
      },
      finishedAt: new Date(NOW - 60_000),
    });
  });

  it('takes a UUID room key (a host with no room key) and a solo game', () => {
    const row = ok({ id: '6F1C2E0A-1D2B-4C3D-9E8F-001122334455-1', mode: 'solo', players: 1, won: false, opponents: [] });
    expect(row.roomId).toBe('offline-6F1C2E0A-1D2B-4C3D-9E8F-001122334455-1');
  });

  it('does not count a win over computer players alone', () => {
    expect(ok({ players: 4, bots: 3, won: true }).won).toBe(false);
    expect(ok({ players: 4, bots: 2, won: true }).won).toBe(true);
    // Nor a win the phone claims from a place that is not first.
    expect(ok({ rank: 2, won: true }).won).toBe(false);
  });

  it('keeps no other person\'s name', () => {
    expect(JSON.stringify(ok())).not.toMatch(/Mum|Sam/);
  });

  it('forgives what does not change the row', () => {
    const row = ok({ source: undefined, bots: undefined, mode: 'warp', title: 7, detail: null, opponents: 'Sam' });
    expect(row.options).toEqual({ source: 'offline', bots: 0 });
    // A fast clock: a result cannot finish in the future.
    expect(ok({ finishedAt: NOW + 3_600_000 }).finishedAt).toEqual(new Date(NOW));
    // A fractional score is rounded, as an online standing is.
    expect(ok({ score: 12.6 }).score).toBe(13);
    // Free text is one short line.
    expect(ok({ title: '  Blackjack\n\tnight  ' }).options.title).toBe('Blackjack night');
  });

  it('refuses what would make the row wrong', () => {
    for (const over of [
      { id: 7 },
      { id: '' },
      { id: '-starts-with-dash' },
      { id: 'has space' },
      { id: 'x'.repeat(97) },
      { game: 'blackjack' },
      { game: 'offline:Black Jack' },
      { source: 'online' },
      { players: 0 },
      { players: 17 },
      { players: 2.5 },
      { bots: 3 },
      { bots: -1 },
      { rank: 0 },
      { rank: 4 },
      { score: 'lots' },
      { score: Number.NaN },
      { score: 2e9 },
      { won: 'yes' },
      { finishedAt: '2026-10-27' },
      { finishedAt: 0 },
      { finishedAt: Date.parse('2025-12-31T23:59:59Z') },
    ]) {
      expect(parseOfflineResult(wire(over), NOW).ok, JSON.stringify(over)).toBe(false);
    }
    expect(parseOfflineResult(null, NOW).ok).toBe(false);
    expect(parseOfflineResult([wire()], NOW).ok).toBe(false);
  });
});

describe('parseOfflineBatch', () => {
  it('records the good, rejects the bad by id, and reads a repeated id once', () => {
    const batch = parseOfflineBatch(
      [wire({ id: 'a-1' }), wire({ id: 'b-1', game: 'nope' }), wire({ id: 'a-1', score: 999 }), { game: 'x' }, 'junk'],
      NOW,
    );
    expect(batch.rows.map((r) => [r.id, r.score])).toEqual([['a-1', 140]]);
    // An entry with no string id cannot be named back; the phone never sends one.
    expect(batch.rejected).toEqual(['b-1']);
  });

  it('reads the first hundred and leaves the rest for the next try', () => {
    const results = Array.from({ length: OFFLINE_BATCH_MAX + 5 }, (_, i) => wire({ id: `room-${i}` }));
    const batch = parseOfflineBatch(results, NOW);
    expect(batch.rows).toHaveLength(OFFLINE_BATCH_MAX);
    expect(batch.rows.at(-1)?.id).toBe(`room-${OFFLINE_BATCH_MAX - 1}`);
    expect(batch.rejected).toEqual([]);
  });
});

describe('offlineBoardTitle', () => {
  it('uses the phone title, else the slug, and says it was offline', () => {
    expect(offlineBoardTitle('offline:maths-sprint', 'Maths Sprint')).toBe('Maths Sprint (offline)');
    expect(offlineBoardTitle('offline:maths-sprint', undefined)).toBe('Maths sprint (offline)');
  });
});
