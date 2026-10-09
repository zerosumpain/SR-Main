import { describe, expect, it } from 'vitest';
import {
  HERO_VIEW_COOKIE,
  chooseHeroView,
  defaultHeroView,
  heroViewCookie,
  isDark,
  londonDay,
  parseHeroView,
  storedChoice,
  twilight,
} from './hero-view';

/** An instant given as UTC, so every case below reads the same on any machine. */
const utc = (iso: string) => new Date(`${iso}Z`);
/** Minutes after London midnight at an instant, for checking dusk against an almanac. */
const londonMinutes = (ms: number) => {
  const [h, m] = new Date(ms)
    .toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false })
    .split(':');
  return +h * 60 + +m;
};

describe('londonDay', () => {
  it('reads the weekday in London, not in UTC', () => {
    // Friday 23:30 UTC in October is already Saturday 00:30 in BST.
    expect(londonDay(utc('2026-10-09T23:30:00'))).toEqual({ weekday: 6, year: 2026, month: 10, day: 10 });
    // Sunday 23:30 UTC in July is Monday 00:30 BST.
    expect(londonDay(utc('2026-07-05T23:30:00')).weekday).toBe(1);
    // In GMT the two agree: Saturday 23:30 UTC is Saturday 23:30.
    expect(londonDay(utc('2026-12-05T23:30:00')).weekday).toBe(6);
  });
});

describe('twilight', () => {
  // Almanac civil twilight for the middle of Britain, to within a quarter-hour.
  it.each([
    ['midsummer', 2026, 6, 21, 3 * 60 + 35, 22 * 60 + 45],
    ['midwinter', 2026, 12, 21, 7 * 60 + 43, 16 * 60 + 28],
    ['the autumn equinox', 2026, 9, 22, 6 * 60 + 15, 19 * 60 + 46],
  ])('lands near the almanac at %s', (_name, y, m, d, dawn, dusk) => {
    const t = twilight(y, m, d);
    expect(Math.abs(londonMinutes(t.dawn) - dawn)).toBeLessThan(15);
    expect(Math.abs(londonMinutes(t.dusk) - dusk)).toBeLessThan(15);
  });

  it('moves with the clocks: dusk is an hour earlier on the wall the day BST ends', () => {
    // 24 Oct is the last BST day of 2026, 25 Oct the first GMT one.
    const before = londonMinutes(twilight(2026, 10, 24).dusk);
    const after = londonMinutes(twilight(2026, 10, 25).dusk);
    expect(before - after).toBeGreaterThan(55);
    expect(before - after).toBeLessThan(65);
  });
});

describe('defaultHeroView', () => {
  it('shows the sentence on a weekday afternoon', () => {
    expect(defaultHeroView(utc('2026-10-09T13:00:00'))).toBe('sentence'); // Fri 14:00 BST
  });

  it('shows the notes on a weekend afternoon', () => {
    expect(defaultHeroView(utc('2026-10-10T13:00:00'))).toBe('notes'); // Sat
    expect(defaultHeroView(utc('2026-10-11T13:00:00'))).toBe('notes'); // Sun
  });

  it('shows the place after dusk and before dawn, weekend or not', () => {
    expect(defaultHeroView(utc('2026-10-09T19:00:00'))).toBe('place'); // Fri 20:00 BST
    expect(defaultHeroView(utc('2026-10-10T21:00:00'))).toBe('place'); // Sat 22:00 BST
    expect(defaultHeroView(utc('2026-10-12T04:30:00'))).toBe('place'); // Mon 05:30 BST
  });

  it('follows the season: 21:00 is daylight in June and dark in December', () => {
    expect(defaultHeroView(utc('2026-06-17T20:00:00'))).toBe('sentence'); // Wed 21:00 BST
    expect(defaultHeroView(utc('2026-12-16T21:00:00'))).toBe('place'); // Wed 21:00 GMT
  });

  it('turns over at dusk to the minute it computes', () => {
    const { dusk } = twilight(2026, 10, 9);
    expect(defaultHeroView(new Date(dusk - 60_000))).toBe('sentence');
    expect(defaultHeroView(new Date(dusk))).toBe('place');
  });

  it('keeps the same wall-clock rules across the BST to GMT changeover', () => {
    // Sun 25 Oct 2026. Clocks went back at 02:00 BST (01:00 UTC).
    expect(defaultHeroView(utc('2026-10-25T00:30:00'))).toBe('place'); // 01:30 BST
    expect(defaultHeroView(utc('2026-10-25T01:30:00'))).toBe('place'); // 01:30 GMT, the second time round
    expect(defaultHeroView(utc('2026-10-25T07:30:00'))).toBe('notes'); // 07:30 GMT, light by then
    // 18:15 on the wall: still light on Saturday (BST), already dark on Sunday (GMT).
    expect(defaultHeroView(utc('2026-10-24T17:15:00'))).toBe('notes'); // Sat 18:15 BST
    expect(defaultHeroView(utc('2026-10-25T18:15:00'))).toBe('place'); // Sun 18:15 GMT
    expect(defaultHeroView(utc('2026-10-25T17:00:00'))).toBe('notes'); // Sun 17:00 GMT, not yet dusk
  });

  it('keeps the same wall-clock rules across the GMT to BST changeover', () => {
    // Sun 29 Mar 2026. Clocks went forward at 01:00 GMT.
    expect(defaultHeroView(utc('2026-03-29T05:00:00'))).toBe('place'); // 06:00 BST, dawn not yet
    expect(defaultHeroView(utc('2026-03-29T06:00:00'))).toBe('notes'); // 07:00 BST
    expect(defaultHeroView(utc('2026-03-29T18:45:00'))).toBe('notes'); // 19:45 BST, still light
    expect(defaultHeroView(utc('2026-03-30T18:45:00'))).toBe('sentence'); // Monday 19:45 BST
    // 19:30 on the wall: dark on Saturday (GMT), still light on Sunday (BST).
    expect(defaultHeroView(utc('2026-03-28T19:30:00'))).toBe('place'); // Sat 19:30 GMT
    expect(defaultHeroView(utc('2026-03-29T18:30:00'))).toBe('notes'); // Sun 19:30 BST
  });

  it('calls a weekday night the place, not the sentence, when UTC still says the day before', () => {
    // Monday 00:30 BST is Sunday 23:30 UTC: dark either way, but never "notes".
    expect(defaultHeroView(utc('2026-07-05T23:30:00'))).toBe('place');
    expect(isDark(utc('2026-07-05T23:30:00'))).toBe(true);
  });
});

describe('parseHeroView', () => {
  it('accepts the three views and nothing else', () => {
    expect(parseHeroView('sentence')).toBe('sentence');
    expect(parseHeroView('place')).toBe('place');
    expect(parseHeroView(' notes ')).toBe('notes');
    // Whatever a visitor or an old build left in the cookie falls back to the hour.
    for (const bad of [null, undefined, '', 'Place', 'auto', 'map', 'notes;', 'place; Path=/', '%70lace', '__proto__', 'toString']) {
      expect(parseHeroView(bad)).toBeNull();
    }
  });
});

describe('heroViewCookie', () => {
  it('keeps a choice for a year, site-wide and Lax', () => {
    expect(heroViewCookie('place')).toBe(`${HERO_VIEW_COOKIE}=place; Max-Age=31536000; Path=/; SameSite=Lax; Secure`);
  });

  it('forgets the choice with an expired empty cookie', () => {
    expect(heroViewCookie(null)).toBe(`${HERO_VIEW_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`);
  });

  it('drops Secure over plain http, where a browser would refuse the cookie', () => {
    expect(heroViewCookie('notes', false)).not.toContain('Secure');
  });
});

describe('chooseHeroView', () => {
  const weekdayNoon = utc('2026-10-09T11:00:00');

  it('falls back to the hour', () => {
    expect(chooseHeroView({ at: weekdayNoon })).toEqual({ view: 'sentence', auto: 'sentence', source: 'auto' });
  });

  it('prefers the visitor’s cookie to the hour', () => {
    expect(chooseHeroView({ cookie: 'place', at: weekdayNoon })).toEqual({ view: 'place', auto: 'sentence', source: 'cookie' });
  });

  it('prefers a ?view= link to both, and ignores a bad one', () => {
    expect(chooseHeroView({ query: 'notes', cookie: 'place', at: weekdayNoon }).view).toBe('notes');
    expect(chooseHeroView({ query: 'notes', cookie: 'place', at: weekdayNoon }).source).toBe('query');
    expect(chooseHeroView({ query: 'nope', cookie: 'place', at: weekdayNoon }).view).toBe('place');
    expect(chooseHeroView({ query: 'nope', cookie: 'junk', at: weekdayNoon }).source).toBe('auto');
  });
});

describe('storedChoice', () => {
  it('stores a view that differs from the hour, and forgets one that matches it', () => {
    expect(storedChoice('place', 'sentence')).toBe('place');
    expect(storedChoice('sentence', 'sentence')).toBeNull();
  });
});
