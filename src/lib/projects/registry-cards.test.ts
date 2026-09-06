import { describe, it, expect } from 'vitest';
import { STATIC_PROJECT_KEYS } from './registry';
import { PROJECT_CARDS } from '../../routes/projects/cards';

// Parity guard: every hardcoded card on /projects renders a public/private
// control keyed on `card.key`. If that key is missing from
// STATIC_PROJECT_KEYS, POST /api/projects/visibility rejects it (400) and the
// toggle silently fails — exactly the bug where scs-earnings and broads-pilot
// wouldn't toggle. This test fails the build if a new card ships without its
// key registered.
//
// It used to regex `visToggle('<key>'` out of the page's MARKUP, because the
// cards were fifteen copies of one block and there was nowhere else to read
// them from. The cards are data now, so the guard reads the manifest — the
// same array the page renders — and can assert the relationship in both
// directions instead of guessing at the regex's own health.
describe('/projects card ↔ registry parity', () => {
  const keys = PROJECT_CARDS.map((c) => c.key);

  it('has the hand-built cards', () => {
    // Guards the manifest itself: if the cards are refactored away, this catches it.
    expect(keys.length).toBeGreaterThanOrEqual(8);
  });

  it('gives every card a distinct key', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(keys)('registers card key "%s"', (key) => {
    expect(STATIC_PROJECT_KEYS).toContain(key);
  });
});

// NOT asserted in reverse: a registered key with no card is legitimate.
// `pulse` is a relocated static bundle, reachable by URL only, and is listed in
// STATIC_PROJECT_KEYS so the build default does not 404 it — see the note above
// STATIC_PROJECT_KEYS in ./visibility.
