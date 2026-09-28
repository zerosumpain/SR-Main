import { describe, expect, it } from 'vitest';
import {
  dethroneDecision,
  dethroneText,
  leaderOf,
  londonWindow,
  ordinal,
  previousDay,
  rankBoard,
  standingsText,
  todaysSteps,
  type BoardRow,
} from './steps';

const at = (iso: string) => new Date(iso);
const row = (email: string, steps: number, when = '2026-09-28T09:00:00Z'): BoardRow => ({ email, steps, updatedAt: at(when) });

describe('londonWindow', () => {
  it('is London midnight to midnight in summer time, tz -60', () => {
    const w = londonWindow(at('2026-09-28T10:00:00Z'));
    expect(w.day).toBe('2026-09-28');
    expect(new Date(w.from * 1000).toISOString()).toBe('2026-09-27T23:00:00.000Z');
    expect(new Date(w.to * 1000).toISOString()).toBe('2026-09-28T23:00:00.000Z');
    expect(w.tz).toBe(-60);
  });

  it('puts 23:30 UTC in BST on the NEXT London day', () => {
    expect(londonWindow(at('2026-09-28T23:30:00Z')).day).toBe('2026-09-29');
  });

  it('is 25 hours long on the day the clocks go back, and tz 0 in winter', () => {
    const w = londonWindow(at('2026-10-25T12:00:00Z'));
    expect(w.day).toBe('2026-10-25');
    expect(w.to - w.from).toBe(25 * 3600);
    expect(w.tz).toBe(-60);
    expect(londonWindow(at('2026-12-01T12:00:00Z')).tz).toBe(0);
  });

  it('previousDay steps back one calendar day', () => {
    expect(previousDay('2026-10-01')).toBe('2026-09-30');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });
});

describe('todaysSteps — pick, never sum', () => {
  const w = londonWindow(at('2026-09-28T10:00:00Z'));

  it('takes the largest record that starts inside today', () => {
    const records = [
      { value: 4000, start: '2026-09-27T23:00:00Z', end: '2026-09-28T08:00:00Z' },
      { value: 6500, start: '2026-09-27T23:00:00Z', end: '2026-09-28T10:00:00Z' },
    ];
    expect(todaysSteps(records, w)).toBe(6500);
  });

  it('ignores yesterday’s record, and answers null when there is nothing today', () => {
    const records = [{ value: 12000, start: '2026-09-26T23:00:00Z', end: '2026-09-27T22:59:00Z' }];
    expect(todaysSteps(records, w)).toBeNull();
    expect(todaysSteps([], w)).toBeNull();
  });

  it('keeps raw values (no ×100 scaling) and rounds', () => {
    expect(todaysSteps([{ value: 8412.4, start: '2026-09-28T06:00:00Z', end: '2026-09-28T09:00:00Z' }], w)).toBe(8412);
  });
});

describe('rankBoard and leaderOf', () => {
  it('ranks most first, ties share a rank and are ordered by who got there first', () => {
    const r = rankBoard([row('c', 500), row('a', 900, '2026-09-28T10:00:00Z'), row('b', 900, '2026-09-28T09:00:00Z')]);
    expect(r.map((x) => [x.email, x.rank])).toEqual([
      ['b', 1],
      ['a', 1],
      ['c', 3],
    ]);
    expect(leaderOf([row('a', 900, '2026-09-28T10:00:00Z'), row('b', 900, '2026-09-28T09:00:00Z')])).toBe('b');
  });

  it('has no leader while nobody has a step', () => {
    expect(leaderOf([])).toBeNull();
    expect(leaderOf([row('a', 0)])).toBeNull();
  });
});

describe('dethroneDecision', () => {
  const none = () => 0;

  it('pushes the old leader when someone overtakes them', () => {
    const d = dethroneDecision({ before: 'a', after: [row('a', 5000), row('b', 6000)], dethronedToday: none });
    expect(d).toEqual({ email: 'a', newLeader: 'b', leaderSteps: 6000, mySteps: 5000 });
  });

  it('stays quiet on the day’s first refresh', () => {
    expect(dethroneDecision({ before: null, after: [row('a', 5000), row('b', 6000)], dethronedToday: none })).toBeNull();
  });

  it('stays quiet when the leader did not change', () => {
    expect(dethroneDecision({ before: 'b', after: [row('a', 5000), row('b', 6000)], dethronedToday: none })).toBeNull();
  });

  it('stays quiet on a tie — level is not knocked off', () => {
    const after = [row('b', 6000, '2026-09-28T09:00:00Z'), row('a', 6000, '2026-09-28T10:00:00Z')];
    // b reached 6,000 first so leads the tie, but a (the old leader) is still rank 1.
    expect(dethroneDecision({ before: 'a', after, dethronedToday: none })).toBeNull();
  });

  it('caps at two a day', () => {
    const after = [row('a', 5000), row('b', 6000)];
    expect(dethroneDecision({ before: 'a', after, dethronedToday: () => 1 })).not.toBeNull();
    expect(dethroneDecision({ before: 'a', after, dethronedToday: () => 2 })).toBeNull();
  });

  it('words the push', () => {
    expect(dethroneText('Sam', 12300, 11999)).toBe('Knocked off the top — Sam has 12,300 steps, you have 11,999.');
  });
});

describe('the 4pm standings', () => {
  const named = (email: string, name: string, steps: number, when?: string) => ({ ...row(email, steps, when), name });
  const board = rankBoard([
    named('a', 'Alex', 12300),
    named('b', 'Bo', 10400),
    named('c', 'Cy', 8412),
    named('d', 'Dee', 3000),
    named('e', 'Eve', 0),
  ]);

  it('tells the leader how far ahead they are', () => {
    expect(standingsText(board, 'a')).toBe("You're top with 12,300 steps — 1,900 ahead of Bo.");
  });

  it('tells everyone else their place and the gap to the top', () => {
    expect(standingsText(board, 'c')).toBe("You're 3rd of 5 with 8,412 steps — 3,888 behind Alex.");
    expect(standingsText(board, 'b')).toBe("You're 2nd of 5 with 10,400 steps — 1,900 behind Alex.");
  });

  it('says joint on a shared place', () => {
    const tied = rankBoard([named('a', 'Alex', 9000, '2026-09-28T09:00:00Z'), named('b', 'Bo', 9000, '2026-09-28T10:00:00Z'), named('c', 'Cy', 100)]);
    expect(standingsText(tied, 'b')).toBe("You're joint top with 9,000 steps — level with Alex.");
    const tied2 = rankBoard([named('a', 'Alex', 9000), named('b', 'Bo', 50), named('c', 'Cy', 50)]);
    expect(standingsText(tied2, 'c')).toBe("You're joint 2nd of 3 with 50 steps — 8,950 behind Alex.");
  });

  it('is null for someone not on the board', () => {
    expect(standingsText(board, 'z')).toBeNull();
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st',
    ]);
  });
});
