import { describe, expect, it } from 'vitest';
import { STALE_MINS, nowCounts, nowStatus, nowSub, since, type NowFields } from './now';

const card = (extra: Partial<NowFields> = {}): NowFields => ({
  isHome: true,
  placeLabel: 'Elton Parade',
  distanceHomeKm: 0,
  ageMins: 3,
  ...extra,
});

describe('nowStatus', () => {
  it('is home or out only on a fresh fix', () => {
    expect(nowStatus(card())).toBe('home');
    expect(nowStatus(card({ isHome: false, placeLabel: 'School' }))).toBe('out');
    expect(nowStatus(card({ ageMins: STALE_MINS }))).toBe('home');
  });

  it('is unknown on a stale fix, even one at home, and with no fix', () => {
    expect(nowStatus(card({ ageMins: STALE_MINS + 1 }))).toBe('unknown');
    expect(nowStatus(card({ ageMins: 47, isHome: false }))).toBe('unknown');
    expect(nowStatus(card({ ageMins: null, isHome: null }))).toBe('unknown');
  });

  it('is unknown on a fresh fix that cannot say whether it is at home', () => {
    expect(nowStatus(card({ isHome: null, placeLabel: null, distanceHomeKm: null }))).toBe('unknown');
    expect(nowCounts([card(), card({ isHome: null })])).toEqual({ home: 1, out: 0, unknown: 1, sharing: 2, notSharing: 0 });
  });

  it('is off for someone not sharing, whatever the trail says', () => {
    expect(nowStatus(card({ notSharing: true }))).toBe('off');
    expect(nowStatus(card({ notSharing: true, ageMins: null }))).toBe('off');
  });
});

describe('nowCounts', () => {
  it('counts a stale-at-home person once, as unknown (the 6-of-5 bug)', () => {
    const members = [card(), card(), card(), card(), card({ ageMins: 47 })];
    expect(nowCounts(members)).toEqual({ home: 4, out: 0, unknown: 1, sharing: 5, notSharing: 0 });
  });

  it('always sums to the number of people sharing', () => {
    const members = [
      card(),
      card({ isHome: false, placeLabel: null, distanceHomeKm: 2.5 }),
      card({ ageMins: 120, isHome: false }),
      card({ ageMins: null, isHome: null }),
      card({ notSharing: true }),
      card({ notSharing: true, sharingUnknown: true, ageMins: null }),
    ];
    const c = nowCounts(members);
    expect(c).toEqual({ home: 1, out: 1, unknown: 2, sharing: 4, notSharing: 2 });
    expect(c.home + c.out + c.unknown).toBe(c.sharing);
    expect(c.sharing + c.notSharing).toBe(members.length);
  });

  it('is all zeros for nobody', () => {
    expect(nowCounts([])).toEqual({ home: 0, out: 0, unknown: 0, sharing: 0, notSharing: 0 });
  });
});

describe('nowSub', () => {
  it('says where and how fresh on a fresh fix', () => {
    expect(nowSub(card())).toBe('At Elton Parade · seen just now');
    expect(nowSub(card({ placeLabel: null }))).toBe('At home · seen just now');
    expect(nowSub(card({ isHome: false, placeLabel: null, distanceHomeKm: 2.5, ageMins: 12 }))).toBe(
      '2.5 km from home · seen 12m ago',
    );
  });

  it('says LAST on a stale fix', () => {
    expect(nowSub(card({ ageMins: 47 }))).toBe('Last at Elton Parade · 47m ago');
    expect(nowSub(card({ ageMins: 180, isHome: false, placeLabel: null, distanceHomeKm: 4 }))).toBe(
      'Last 4 km from home · 3h ago',
    );
    expect(nowSub(card({ ageMins: 90, isHome: false, placeLabel: null, distanceHomeKm: null }))).toBe('Last fix 2h ago');
  });

  it('says nothing about position for someone not sharing', () => {
    expect(nowSub(card({ notSharing: true }))).toBe('Not sharing their location.');
    expect(nowSub(card({ notSharing: true, sharingUnknown: true }))).toMatch(/^Sharing unknown/);
    expect(nowSub(card({ ageMins: null }))).toBe('No position on the trail.');
  });
});

describe('since', () => {
  it('rounds to the unit that reads', () => {
    expect(since(null)).toBe('never');
    expect(since(4)).toBe('just now');
    expect(since(47)).toBe('47m ago');
    expect(since(150)).toBe('3h ago');
    expect(since(60 * 50)).toBe('2d ago');
  });
});
