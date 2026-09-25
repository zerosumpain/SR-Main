import { describe, it, expect } from 'vitest';
import {
  FAMILIES,
  familyOf,
  kindLabel,
} from './thought-groups';


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

describe('kindLabel', () => {
  it('strips the family prefix and the underscores', () => {
    expect(kindLabel('musing_health')).toBe('health');
    expect(kindLabel('mail_money_admin')).toBe('money admin');
    expect(kindLabel('intel_emerging_hub')).toBe('emerging hub');
    expect(kindLabel('pattern_break')).toBe('pattern break');
  });
});

describe('subjectKey', () => {
  it('strips a trailing day or ISO-week segment and nothing else', async () => {
    const { subjectKey } = await import('./thought-groups');
    expect(subjectKey('free_window:2026-09-04')).toBe('free_window');
    expect(subjectKey('pattern_break:p1:2026-09-02')).toBe('pattern_break:p1');
    expect(subjectKey('mail:burst:security:2026-09-01')).toBe('mail:burst:security');
    expect(subjectKey('correlation_probe:p1:2026-W36')).toBe('correlation_probe:p1');
    expect(subjectKey('unknown_place:p1')).toBe('unknown_place:p1');
    expect(subjectKey('musing:a-clear-window')).toBe('musing:a-clear-window');
  });
});
