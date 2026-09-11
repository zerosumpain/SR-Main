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

    it(`${label}: the short labels and detail lines still fit the diagram's boxes`, () => {
      // The boxes are a fixed width in the viewBox. SVG text does not wrap — a
      // long line runs out of the box and over the next one, and it reads as a
      // bug in the page rather than in this file.
      for (const stop of journey(sealed)) {
        expect(stop.short.length, stop.short).toBeLessThanOrEqual(18);
        // 20, not 22: measured at 1440, a 21-character line ran past the box's
        // right edge. Monospace at the label size is about 7.2 units a character
        // against 144 units of usable box.
        expect(stop.detail.length, stop.detail).toBeLessThanOrEqual(20);
      }
    });

    it(`${label}: names the model's maker among the things nobody can reach`, () => {
      // It says "OpenAI" now rather than "the provider". Naming the company is
      // the more useful sentence for a reader deciding whether to upload, and the
      // page should not be vague about the one party it cannot speak for.
      expect(beyond(sealed).join(' ')).toContain('OpenAI');
    });
  }
});

describe('nothing is copied into a backup, and the page may now say so', () => {
  // The nightly `pg_dump` stopped including the policy tables on 2026-09-11.
  // Until then BOTH versions of this page had to talk about backups: the
  // ordinary one warned that a readable copy survived a fortnight, and the
  // sealed one explained why its copy was gibberish. Neither is true any more,
  // and a page that kept saying either would be frightening a reader about
  // something that no longer happens.
  for (const sealed of [false, true]) {
    it(`${sealed ? 'sealed' : 'ordinary'}: never claims a backup copy outlives the delete`, () => {
      const said = `${journey(sealed).at(-1)!.what} ${beyond(sealed).join(' ')} ${headline(sealed)}`;
      expect(said).not.toMatch(/fortnight/i);
      expect(said).not.toMatch(/backups? (still|keep|hold|may)/i);
      expect(said).toMatch(/nothing is copied off this machine|never copied into a backup/i);
    });
  }

  it('still admits what an ordinary run leaves on the live machine', () => {
    // Excluding the backups does not vacuum the database. Deleted rows sit in its
    // own scratch space until it tidies up, and for an unsealed run those are
    // readable to anyone who can already read the database. Dropping that with
    // the backup line would have traded one overclaim for another.
    const last = journey(false).at(-1)!.what;
    expect(last).toMatch(/scratch space/i);
    expect(last).toMatch(/readable to anyone who can already read the database/i);
    expect(headline(false)).toMatch(/seal a run/i);
  });

  it('makes sealing about the disk rather than about backups', () => {
    expect(headline(true)).toMatch(/unreadable/i);
    expect(headline(true)).toMatch(/disk|database|working files/i);
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
    expect(beyond(false).join(' ')).toMatch(/search provider/i);
    expect(beyond(false).join(' ')).not.toMatch(/backup/i);
  });

  it('no longer says the provider’s copy cannot be deleted, because that was not true', () => {
    // Shipped as "the one thing on this page we cannot delete for you", which was
    // too strong and had no source behind it. Checked 2026-09-11: OpenAI keeps it
    // up to 30 days for abuse monitoring and then deletes it, it can be removed
    // from that account sooner, and the order that once forced indefinite
    // preservation was lifted. What is true is "not from here".
    for (const sealed of [false, true]) {
      const said = beyond(sealed).join(' ');
      expect(said).toMatch(/30 days/);
      expect(said).toMatch(/not from here/i);
      expect(said).not.toMatch(/cannot delete it for you|can never be deleted/i);
    }
  });
});
