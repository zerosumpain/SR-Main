import { describe, it, expect } from 'vitest';
import {
  ExclusionSet,
  NO_EXCLUSIONS,
  eventKeys,
  exclusionKey,
  minuteKey,
  titleKeyOf,
  type ExcludableEvent,
} from './exclusions';

function ev(title: string, start: string, uid: string | null = null): ExcludableEvent {
  return { uid, title, start };
}

describe('titleKeyOf', () => {
  it('ignores case and runs of whitespace', () => {
    expect(titleKeyOf('  Bin   Day ')).toBe('bin day');
    expect(titleKeyOf('BIN DAY')).toBe(titleKeyOf('bin day'));
  });

  it('does NOT strip punctuation or emoji', () => {
    // Over-matching is the expensive direction: it makes the engine blind to
    // something the owner never asked to hide.
    expect(titleKeyOf('Bins 🗑')).not.toBe(titleKeyOf('Bins'));
  });

  it('is empty for a missing title, so it can never be a match key', () => {
    expect(titleKeyOf(null)).toBe('');
    expect(titleKeyOf('   ')).toBe('');
  });
});

describe('minuteKey', () => {
  it('is stable across the second- and millisecond-level drift iCloud introduces', () => {
    expect(minuteKey('2026-09-01T09:00:00.000Z')).toBe(minuteKey('2026-09-01T09:00:47.913Z'));
  });

  it('separates two occurrences an hour apart', () => {
    expect(minuteKey('2026-09-01T09:00:00Z')).not.toBe(minuteKey('2026-09-01T10:00:00Z'));
  });

  it('is empty for an unparseable date rather than throwing', () => {
    expect(minuteKey('not a date')).toBe('');
  });
});

describe('exclusionKey', () => {
  it('refuses a series rule with no UID rather than inventing one', () => {
    // A row that matches everything or nothing depending on how the comparison
    // happens to be written is worse than no row.
    expect(exclusionKey({ scope: 'series', uid: null })).toBeNull();
  });

  it('refuses an occurrence rule missing either half', () => {
    expect(exclusionKey({ scope: 'occurrence', uid: 'u1' })).toBeNull();
    expect(exclusionKey({ scope: 'occurrence', occurrenceStart: '2026-09-01T09:00:00Z' })).toBeNull();
  });

  it('refuses a title rule with an empty title', () => {
    expect(exclusionKey({ scope: 'title', titleKey: '   ' })).toBeNull();
  });

  it('builds the three shapes', () => {
    expect(exclusionKey({ scope: 'series', uid: 'u1' })).toBe('series:u1');
    expect(exclusionKey({ scope: 'occurrence', uid: 'u1', occurrenceStart: '2026-09-01T09:00:00Z' }))
      .toBe('occurrence:u1:2026-09-01T09:00');
    expect(exclusionKey({ scope: 'title', titleKey: 'Bin Day' })).toBe('title:bin day');
  });
});

describe('the rolling reminder', () => {
  // The case John actually named. One UID, expanded into an occurrence every
  // week; excluding the series must silence all of them at once.
  const uid = 'rolling-reminder-uid';
  const occurrences = [
    ev('Water the plants', '2026-09-01T09:00:00Z', uid),
    ev('Water the plants', '2026-09-08T09:00:00Z', uid),
    ev('Water the plants', '2026-09-15T09:00:00Z', uid),
  ];

  it('one series rule hides every occurrence', () => {
    const set = ExclusionSet.fromRules([{ scope: 'series', uid }]);
    const { kept, hidden } = set.partition(occurrences);
    expect(hidden).toHaveLength(3);
    expect(kept).toHaveLength(0);
  });

  it('an occurrence rule hides exactly one', () => {
    const set = ExclusionSet.fromRules([
      { scope: 'occurrence', uid, occurrenceStart: '2026-09-08T09:00:00Z' },
    ]);
    const { kept, hidden } = set.partition(occurrences);
    expect(hidden).toHaveLength(1);
    expect(hidden[0].start).toBe('2026-09-08T09:00:00Z');
    expect(kept).toHaveLength(2);
  });

  it('says which rule did the hiding, so the tab can offer the right undo', () => {
    const set = ExclusionSet.fromRules([{ scope: 'series', uid }]);
    expect(set.reasonFor(occurrences[0])).toBe(`series:${uid}`);
  });
});

describe('the recreated-each-time entry', () => {
  // Some calendars write a fresh UID per occurrence, so `series` cannot catch
  // them and only the title can.
  const recreated = [
    ev('Bin day', '2026-09-01T07:00:00Z', 'uid-a'),
    ev('Bin day', '2026-09-08T07:00:00Z', 'uid-b'),
    ev('Bin day', '2026-09-15T07:00:00Z', 'uid-c'),
  ];

  it('a series rule catches only its own UID', () => {
    const set = ExclusionSet.fromRules([{ scope: 'series', uid: 'uid-a' }]);
    expect(set.partition(recreated).hidden).toHaveLength(1);
  });

  it('a title rule catches all of them', () => {
    const set = ExclusionSet.fromRules([{ scope: 'title', titleKey: 'Bin Day' }]);
    expect(set.partition(recreated).hidden).toHaveLength(3);
  });

  it('a title rule still works on an event with no UID at all', () => {
    const set = ExclusionSet.fromRules([{ scope: 'title', titleKey: 'bin day' }]);
    expect(set.excludes(ev('Bin day', '2026-09-01T07:00:00Z', null))).toBe(true);
  });
});

describe('what must stay visible', () => {
  const set = ExclusionSet.fromRules([
    { scope: 'series', uid: 'reminder' },
    { scope: 'title', titleKey: 'bin day' },
  ]);

  it('leaves an unrelated event alone', () => {
    expect(set.excludes(ev('Dentist', '2026-09-02T14:00:00Z', 'dentist-uid'))).toBe(false);
  });

  it('does not hide a similar but distinct title', () => {
    expect(set.excludes(ev('Bin day collection changed', '2026-09-02T07:00:00Z'))).toBe(false);
  });

  it('hides nothing at all when there are no rules', () => {
    expect(NO_EXCLUSIONS.excludes(ev('Anything', '2026-09-02T07:00:00Z', 'u'))).toBe(false);
    expect(NO_EXCLUSIONS.size).toBe(0);
  });

  it('drops an underivable rule rather than letting it match everything', () => {
    const broken = ExclusionSet.fromRules([
      { scope: 'series', uid: null },
      { scope: 'title', titleKey: '' },
    ]);
    expect(broken.size).toBe(0);
    expect(broken.excludes(ev('Dentist', '2026-09-02T14:00:00Z', 'x'))).toBe(false);
  });
});

describe('eventKeys', () => {
  it('offers every key an event could be hidden by', () => {
    const keys = eventKeys(ev('Bin day', '2026-09-01T07:00:00Z', 'u1'));
    expect(keys).toContain('series:u1');
    expect(keys).toContain('occurrence:u1:2026-09-01T07:00');
    expect(keys).toContain('title:bin day');
  });

  it('offers only the title key when there is no UID', () => {
    expect(eventKeys(ev('Bin day', '2026-09-01T07:00:00Z', null))).toEqual(['title:bin day']);
  });

  it('offers nothing for an event with neither UID nor title', () => {
    expect(eventKeys({ start: '2026-09-01T07:00:00Z' })).toEqual([]);
  });
});

describe('partition reports both halves', () => {
  it('counts what was hidden, so a filtered diary never passes for an empty one', () => {
    const set = ExclusionSet.fromRules([{ scope: 'title', titleKey: 'standup' }]);
    const { kept, hidden } = set.partition([
      ev('Standup', '2026-09-01T09:00:00Z'),
      ev('Standup', '2026-09-02T09:00:00Z'),
      ev('Dentist', '2026-09-02T14:00:00Z'),
    ]);
    expect(kept).toHaveLength(1);
    expect(hidden).toHaveLength(2);
  });
});
