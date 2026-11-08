import { describe, expect, it } from 'vitest';
import { namesIn, readReplaces, replacesEntry, sameTopic, supersededBy, type TopicCandidate } from './topics';

// Production, 2-5 October 2026: one subject, three cards.
const hutton = 'Use the geology festival’s remaining Hutton exhibitions as a Barns Ness follow-up';
const nov = 'A bookable Barns Ness geology walk is now listed for 1 November';
const oct = 'Book the Dunbar–Barns Ness geology walk on 16 October';

describe('namesIn', () => {
  it('keeps the names, not the first word, months or common verbs', () => {
    expect([...namesIn(oct)].sort()).toEqual(['barns', 'dunbar', 'ness']);
    expect([...namesIn(nov)].sort()).toEqual(['barns', 'ness']);
  });
});

describe('sameTopic', () => {
  it('joins the three Barns Ness notes', () => {
    expect(sameTopic(oct, nov)).toBe(true);
    expect(sameTopic(oct, hutton)).toBe(true);
  });

  it('keeps apart notes that share one name or none', () => {
    expect(sameTopic(oct, 'A Dunbar harbour fish supper worth trying')).toBe(false);
    expect(sameTopic('Try a small physics-based visual prototype, not a graphing app', 'Build a home coverage watchdog for heating')).toBe(false);
  });
});

describe('supersededBy', () => {
  const at = (d: string) => new Date(`${d}T12:00:00Z`);
  const older: TopicCandidate[] = [
    { id: 'a', kind: 'think_suggest', title: hutton, createdAt: at('2026-10-02'), answered: false },
    { id: 'b', kind: 'think_suggest', title: nov, createdAt: at('2026-10-03'), answered: false },
    { id: 'c', kind: 'think_suggest', title: nov, createdAt: at('2026-10-03'), answered: true },
    { id: 'd', kind: 'think_money_analysis', title: 'Barns Ness Dunbar spend', createdAt: at('2026-10-03'), answered: false },
    { id: 'e', kind: 'think_suggest', title: nov, createdAt: at('2026-09-01'), answered: false },
  ];
  const fresh = { id: 'f', kind: 'think_suggest', title: oct, createdAt: at('2026-10-05') };

  it('replaces older, unanswered research notes on the subject, inside the window', () => {
    expect(supersededBy(fresh, older).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('never touches an answered note, another family, or itself', () => {
    expect(supersededBy(fresh, [...older, { ...fresh, answered: false }]).map((o) => o.id)).not.toContain('f');
    expect(supersededBy({ ...fresh, kind: 'think_build' }, older)).toEqual([]);
  });

  it('records what it replaced, readable back', () => {
    const entry = replacesEntry([{ id: 'a', title: hutton }, { id: 'b', title: nov }], at('2026-10-05'));
    expect(entry.label).toBe('Replaces 2 earlier notes on the same subject');
    expect(readReplaces([{ kind: 'calendar_event' }, entry])).toEqual([{ id: 'a', title: hutton }, { id: 'b', title: nov }]);
    expect(readReplaces(null)).toEqual([]);
  });
});
