import { describe, expect, it } from 'vitest';
import { DEFAULT_HERO_VIEW, HERO_VIEW_COOKIE, chooseHeroView, heroViewCookie, parseHeroView, storedChoice } from './hero-view';

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
  it('falls back to the notes', () => {
    expect(DEFAULT_HERO_VIEW).toBe('notes');
    expect(chooseHeroView({})).toEqual({ view: 'notes', auto: 'notes', source: 'auto' });
  });

  it('prefers the visitor’s cookie to the default', () => {
    expect(chooseHeroView({ cookie: 'place' })).toEqual({ view: 'place', auto: 'notes', source: 'cookie' });
  });

  it('prefers a ?view= link to both, and ignores a bad one', () => {
    expect(chooseHeroView({ query: 'sentence', cookie: 'place' }).view).toBe('sentence');
    expect(chooseHeroView({ query: 'sentence', cookie: 'place' }).source).toBe('query');
    expect(chooseHeroView({ query: 'nope', cookie: 'place' }).view).toBe('place');
    expect(chooseHeroView({ query: 'nope', cookie: 'junk' }).source).toBe('auto');
  });
});

describe('storedChoice', () => {
  it('stores a view other than the default, and forgets the default', () => {
    expect(storedChoice('place')).toBe('place');
    expect(storedChoice('sentence')).toBe('sentence');
    expect(storedChoice('notes')).toBeNull();
  });
});
