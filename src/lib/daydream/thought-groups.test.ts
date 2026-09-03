import { describe, it, expect } from 'vitest';
import {
  FAMILIES,
  familyOf,
  kindLabel,
  likelihoodBand,
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

describe('likelihoodBand', () => {
  // Bands are relative to the threshold, which MOVES: it opens at 0.75 and
  // falls towards 0.45 as feedback accumulates. Fixed cut-offs would relabel
  // every historical thought each time it shifted.
  it('calls the same score different things at different thresholds', () => {
    expect(likelihoodBand(0.7, 0.75).id).toBe('held');
    expect(likelihoodBand(0.7, 0.45).id).toBe('strong');
  });

  it('separates just-over from well-clear', () => {
    expect(likelihoodBand(0.76, 0.75).id).toBe('marginal');
    expect(likelihoodBand(0.82, 0.75).id).toBe('likely');
    expect(likelihoodBand(0.95, 0.75).id).toBe('strong');
  });

  it('explains itself in numbers a reader can check', () => {
    expect(likelihoodBand(0.7, 0.75).meaning).toContain('0.70');
    expect(likelihoodBand(0.7, 0.75).meaning).toContain('0.75');
  });
});

describe('familyMark / feed states', () => {
  it('marks every family with a short word and never a slug', async () => {
    const { familyMark, FAMILY_MARK, FAMILIES } = await import('./thought-groups');
    for (const id of Object.keys(FAMILIES)) expect(FAMILY_MARK[id]).toMatch(/^[A-Z]{4,7}$/);
    expect(familyMark('musing_health')).toBe('MUSE');
    expect(familyMark('mail_security')).toBe('MAIL');
    expect(familyMark('intel_missing_link')).toBe('GRAPH');
    expect(familyMark('unknown_frequent_place')).toBe('PLACE');
    expect(familyMark('free_window')).toBe('PATTERN');
    expect(familyMark('rule_driven')).toBe('RULE');
  });

  it('maps every status to exactly one reader state, unknown to undecided', async () => {
    const { FEED_STATES, feedStateOf, statusesFor } = await import('./thought-groups');
    const all = FEED_STATES.flatMap((s) => s.statuses);
    expect(new Set(all).size).toBe(all.length);
    expect(feedStateOf('delivered')).toBe('sent');
    expect(feedStateOf('suppressed')).toBe('held');
    expect(feedStateOf('actioned')).toBe('filed');
    expect(feedStateOf('new')).toBe('undecided');
    expect(feedStateOf('something_else')).toBe('undecided');
    expect(statusesFor('held')).toEqual(['suppressed']);
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
