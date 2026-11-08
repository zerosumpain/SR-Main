import { describe, expect, it } from 'vitest';
import { localDayCadence } from './local-days';

describe('deploys per London day', () => {
  it('puts a deploy between midnight and 01:00 BST on the London day, not the UTC one', () => {
    const days = localDayCadence(['2026-10-09T23:10:00Z', '2026-10-09T22:50:00Z', '2026-10-09T10:00:00Z']);
    // 23:10 UTC is 00:10 BST on the 10th; 22:50 UTC is 23:50 BST on the 9th.
    expect(days).toEqual([
      { date: '2026-10-09', count: 2 },
      { date: '2026-10-10', count: 1 },
    ]);
  });

  it('fills quiet days with zeroes, across a clock change, and ignores junk', () => {
    const days = localDayCadence(['2026-10-23T09:00:00Z', 'nope', new Date('2026-10-27T09:00:00Z')]);
    expect(days.map((d) => d.date)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(days.map((d) => d.count)).toEqual([1, 0, 0, 0, 1]);
  });

  it('is empty with no deploys', () => {
    expect(localDayCadence([])).toEqual([]);
  });
});
