import { describe, it, expect } from 'vitest';
import { OWNER_ONLY_CARDS } from './owner-cards.server';
import { PROJECT_CARDS } from './cards';
import { SHARE_PASSWORD_KEYS, sharePasswordAllowed } from '$lib/projects/share-password';
import { STATIC_PROJECT_KEYS } from '$lib/projects/registry';

// The inverse of registry-cards.test.ts. That one forces every PUBLIC card's
// key into STATIC_PROJECT_KEYS so its toggle works; this one forces every
// owner-only card to stay OUT of both lists, because each membership would
// publish the card by a different door:
//
//  - in STATIC_PROJECT_KEYS, `defaultsPublic()` returns true, so the card is
//    public on first deploy until a `project_visibility` row is written by hand;
//  - in PROJECT_CARDS, the title, blurb and slug ship to anonymous visitors in
//    a client JS chunk even when the markup does not render.
//
// /projects/landgrab renders five people's movement history, three of them
// children, starting at the front door. The privacy property here is "nothing
// about this page reaches a non-owner", and these assertions are what keeps it
// true after the next refactor.
describe('/projects owner-only cards', () => {
  it.each(OWNER_ONLY_CARDS.map((c) => c.key))('keeps "%s" out of STATIC_PROJECT_KEYS', (key) => {
    expect(STATIC_PROJECT_KEYS).not.toContain(key);
  });

  it.each(OWNER_ONLY_CARDS.map((c) => c.key))('keeps "%s" out of the client manifest', (key) => {
    expect(PROJECT_CARDS.map((c) => c.key)).not.toContain(key);
  });

  it('marks every card ownerOnly, so the foot renders no toggle or Share', () => {
    for (const c of OWNER_ONLY_CARDS) expect(c.ownerOnly).toBe(true);
  });

  it('points each card at its own address on the site', () => {
    // An app the site routes to its own root path (Wildmind's /wildmind/) is on the site too.
    for (const c of OWNER_ONLY_CARDS.filter((c) => !c.external)) expect([`/projects/${c.key}`, `/${c.key}/`]).toContain(c.href);
  });

  it('sends an external card to an absolute address off the site', () => {
    for (const c of OWNER_ONLY_CARDS.filter((c) => c.external)) {
      expect(c.href).toMatch(/^https?:\/\//);
      expect(c.href).not.toMatch(/strangeramblings\.com/);
    }
  });

  it('allows external links on owner-only cards only', () => {
    expect(PROJECT_CARDS.filter((c) => c.external).map((c) => c.key)).toEqual([]);
  });
});

describe('share links on a project’s own domain', () => {
  it('sends the Spine’s recipients to data-spine.com, which holds anyone without a link', () => {
    const spine = PROJECT_CARDS.find((c) => c.key === 'spine');
    expect(spine?.shareBase).toBe('https://data-spine.com/');
  });

  it('only ever uses an https root of a domain', () => {
    for (const c of PROJECT_CARDS) {
      if (c.shareBase) expect(c.shareBase).toMatch(/^https:\/\/[a-z0-9.-]+\/$/);
    }
  });
});

describe('share links that ask for a password', () => {
  it('only the Spine checks a link password, so only its links may set one', () => {
    // The card shows the toggle; the API reads SHARE_PASSWORD_KEYS. They must agree.
    expect(PROJECT_CARDS.filter((c) => c.sharePassword).map((c) => c.key)).toEqual([...SHARE_PASSWORD_KEYS]);
    expect([...SHARE_PASSWORD_KEYS]).toEqual(['spine']);
    expect(sharePasswordAllowed('spine')).toBe(true);
    expect(sharePasswordAllowed('policy-engine')).toBe(false);
    expect(sharePasswordAllowed('no-such-project')).toBe(false);
  });
});
