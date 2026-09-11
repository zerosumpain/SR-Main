import { describe, it, expect } from 'vitest';
import { OWNER_ONLY_CARDS } from './owner-cards.server';
import { PROJECT_CARDS } from './cards';
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
  it('has at least one', () => {
    expect(OWNER_ONLY_CARDS.length).toBeGreaterThan(0);
  });

  it.each(OWNER_ONLY_CARDS.map((c) => c.key))('keeps "%s" out of STATIC_PROJECT_KEYS', (key) => {
    expect(STATIC_PROJECT_KEYS).not.toContain(key);
  });

  it.each(OWNER_ONLY_CARDS.map((c) => c.key))('keeps "%s" out of the client manifest', (key) => {
    expect(PROJECT_CARDS.map((c) => c.key)).not.toContain(key);
  });

  it('marks every card ownerOnly, so the foot renders no toggle or Share', () => {
    for (const c of OWNER_ONLY_CARDS) expect(c.ownerOnly).toBe(true);
  });

  it('points each card at its own /projects address', () => {
    for (const c of OWNER_ONLY_CARDS) expect(c.href).toBe(`/projects/${c.key}`);
  });
});
