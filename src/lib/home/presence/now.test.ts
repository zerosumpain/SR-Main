import { describe, expect, it } from 'vitest';
import { STALE_MINS, feedCheckText, nowCounts, nowLabel, nowStatus, nowSub, since, type NowFields } from './now';

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
    expect(nowSub(card())).toBe('At Elton Parade · location just now');
    expect(nowSub(card({ placeLabel: null }))).toBe('At home · location just now');
    expect(nowSub(card({ isHome: false, placeLabel: null, distanceHomeKm: 2.5, ageMins: 12 }))).toBe(
      '2.5 km from home · location 12m ago',
    );
  });

  it('says LAST on a stale fix', () => {
    expect(nowSub(card({ ageMins: 47 }))).toBe('Last at Elton Parade · location 47m ago');
    expect(nowSub(card({ ageMins: 180, isHome: false, placeLabel: null, distanceHomeKm: 4 }))).toBe(
      'Last 4 km from home · location 3h ago',
    );
    expect(nowSub(card({ ageMins: 90, isHome: false, placeLabel: null, distanceHomeKm: null }))).toBe('Location 2h ago');
  });

  it('says nothing about position for someone not sharing', () => {
    expect(nowSub(card({ notSharing: true }))).toBe('Not sharing their location.');
    expect(nowSub(card({ notSharing: true, sharingUnknown: true }))).toMatch(/^Sharing unknown/);
    expect(nowSub(card({ ageMins: null }))).toBe('No location received.');
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


describe('location and feed freshness remain separate', () => {
  const now = new Date('2026-09-26T21:00:00Z');
  it('keeps an older position visible without calling the person unknown or claiming a new location', () => {
    const m = card({ ageMins: 180 });
    expect(nowLabel(m)).toBe('last known');
    expect(nowSub(m)).toBe('Last at Elton Parade · location 3h ago');
    expect(feedCheckText({ source: 'companion', checkedAt: '2026-09-26T20:59:40Z' }, now)).toBe('App feed checked 20s ago');
    expect(nowStatus(m)).toBe('unknown'); // A server check never refreshes the GPS age.
  });
  it('distinguishes an absent location and sharing off from an older location', () => {
    expect(nowLabel(card({ ageMins: null }))).toBe('no location');
    expect(nowLabel(card({ notSharing: true, ageMins: 180 }))).toBe('off');
    expect(nowLabel(card())).toBe('home');
  });
  it('does not describe an old or missing source check as just now', () => {
    expect(feedCheckText({ source: 'companion', checkedAt: '2026-09-26T20:58:00Z' }, now)).toBe('App feed checked 2m ago');
    expect(feedCheckText({ source: 'life360', checkedAt: null }, now)).toBe('HA feed check unavailable');
    expect(feedCheckText({ source: 'companion', checkedAt: 'invalid' }, now)).toBe('App feed check unavailable');
    expect(feedCheckText(undefined, now)).toBeNull();
  });
});
