// WHAT THE PAGE PROMISES ABOUT SOMEBODY'S UNPUBLISHED PAPER.
//
// Ordinary copy, except that it is not: every sentence here is read by somebody
// deciding whether to hand over work that is not theirs to leak. The tests that
// matter are not "does it render" but "does it still refuse to overclaim" — an
// edit that quietly drops the provider caveat would read better and be a lie,
// and nothing else in the suite would notice.
import { describe, expect, it } from 'vitest';
import { beyond, destroyed, headline, journey, kept, PLACE_LABEL } from './handling';

describe('the journey', () => {
  for (const sealed of [false, true]) {
    const label = sealed ? 'sealed' : 'ordinary';

    it(`${label}: every stop says where it happens and what happens`, () => {
      const stops = journey(sealed);
      expect(stops).toHaveLength(6);
      for (const stop of stops) {
        expect(stop.title.length).toBeGreaterThan(3);
        expect(stop.what.length).toBeGreaterThan(40);
        expect(PLACE_LABEL[stop.place]).toBeTruthy();
      }
    });

    it(`${label}: exactly one stop leaves the site, and it carries the caveat`, () => {
      const away = journey(sealed).filter((s) => s.place === 'away');
      expect(away).toHaveLength(1);
      // The diagram is built around this one stop. If a second ever appears, the
      // picture silently draws only the first.
      expect(away[0].emphasis).toContain('cannot delete');
    });

    it(`${label}: the short labels still fit the diagram's boxes`, () => {
      // The boxes are a fixed width in the viewBox. A long label does not wrap —
      // it runs out of the box and over the next one, and it looks like a bug in
      // the page rather than in this file.
      for (const stop of journey(sealed)) expect(stop.short.length).toBeLessThanOrEqual(18);
    });

    it(`${label}: names the provider among the things nobody can reach`, () => {
      expect(beyond(sealed).join(' ')).toMatch(/provider/i);
    });
  }
});

describe('sealing changes the ending, not the story', () => {
  it('tells an ordinary run that backups keep a READABLE copy, and says what to do about it', () => {
    const said = `${journey(false).at(-1)!.what} ${beyond(false).join(' ')} ${headline(false)}`;
    expect(said).toMatch(/readable/i);
    expect(said).toMatch(/seal/i);
  });

  it('tells a sealed run the same copies are unreadable, and never that they are gone', () => {
    const last = journey(true).at(-1)!.what;
    expect(last).toMatch(/gibberish/i);
    // The honest claim is "unreadable", not "deleted". A backup is not reached by
    // any delete, and saying otherwise is the exact overclaim this feature exists
    // to avoid.
    expect(last).not.toMatch(/\bdeleted from the backups?\b/i);
    expect(headline(true)).toMatch(/unreadable/i);
  });

  it('destroys the key FIRST on a sealed run, because the order is the guarantee', () => {
    expect(destroyed(true)[0]).toMatch(/^The key/);
    expect(destroyed(false).some((l) => /key/i.test(l))).toBe(false);
  });

  it('never claims a sealed run kept the conversations with the model', () => {
    expect(kept(true).join(' ')).toMatch(/not a word of what was said/i);
    expect(kept(false).join(' ')).toMatch(/conversations with the model/i);
  });

  it('says a sealed run has no third place to have gone', () => {
    // No research, no comparison, no memory of the bodies it meets — so the list
    // of unreachable places is the provider and nothing else. If that stops being
    // true, this fails before the page starts claiming it.
    expect(beyond(true)).toHaveLength(2);
    expect(beyond(false).join(' ')).toMatch(/search provider|backups/i);
  });
});
