import { describe, it, expect } from 'vitest';
import { FAMILIES, familyOf } from './thought-groups';


describe('familyOf', () => {
  it('files both spellings of the place detector together', () => {
    // Renamed in August; the old rows stayed in the ledger.
    expect(familyOf('unknown_place')).toBe(FAMILIES.places);
    expect(familyOf('unknown_frequent_place')).toBe(FAMILIES.places);
  });

  it('files an open kind space by prefix, so new suffixes never fall through', () => {
    expect(familyOf('musing_health')).toBe(FAMILIES.musings);
    expect(familyOf('musing_a_theme_invented_next_year')).toBe(FAMILIES.musings);
    expect(familyOf('mail_security')).toBe(FAMILIES.mail);
    expect(familyOf('mail_something_new')).toBe(FAMILIES.mail);
    expect(familyOf('intel_broker')).toBe(FAMILIES.graph);
  });

  it('puts the detector kinds in patterns', () => {
    for (const k of ['near_offer', 'free_window', 'pattern_break', 'context_meets_health']) {
      expect(familyOf(k)).toBe(FAMILIES.patterns);
    }
  });

  it('never returns undefined for an unknown kind', () => {
    expect(familyOf('something_nobody_has_written_yet')).toBeTruthy();
  });
});
