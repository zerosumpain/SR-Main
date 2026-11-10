import { describe, expect, it } from 'vitest';
import { chaseDue, chaseOrder, chaseText, digestDue, digestText, openStep, type LoopRow } from './loops';
import { storeAction } from './plan';
import { storeSolve } from './solution';

const reminder = storeAction({ kind: 'reminder', text: 'Chase the bike dispatch', date: '2026-11-12', time: null }, null);
const row = (over: Partial<LoopRow> = {}): LoopRow => ({
  id: 'n1',
  title: 'The bike has not shipped',
  narrative: 'Ordered on the 1st and still no dispatch email.\nNext: Chase the bike dispatch',
  actions: [reminder],
  deliveredAt: new Date('2026-11-07T10:00:00Z'),
  until: null,
  ...over,
});
const at = (iso: string, chased: string[] = []) => ({ now: new Date(iso), today: iso.slice(0, 10), chased: new Set(chased) });

describe('openStep', () => {
  it('the press still waiting, in the button\'s words', () => {
    expect(openStep([reminder])).toBe(reminder.label);
    expect(openStep([{ ...reminder, done: { at: 'x' } }])).toBeNull();
    expect(openStep([])).toBeNull();
  });

  it('a page to open is not a loop', () => {
    expect(openStep([storeSolve({ kind: 'open', url: '/trips', label: 'Open your trips' })])).toBeNull();
    expect(openStep([storeSolve({ kind: 'home', entities: ['light.study'] })])).toBe('Turn off study');
  });
});

describe('chaseDue', () => {
  it('an undated note after two days, once, and never past a week', () => {
    expect(chaseDue(row(), at('2026-11-08T12:00:00Z'))).toBe(false);
    expect(chaseDue(row(), at('2026-11-09T12:00:00Z'))).toBe(true);
    expect(chaseDue(row(), at('2026-11-09T12:00:00Z', ['n1']))).toBe(false);
    expect(chaseDue(row(), at('2026-11-15T12:00:00Z'))).toBe(false);
  });

  it('a dated note on its last day or the day before, not sooner than a day after it was sent', () => {
    const dated = row({ until: '2026-11-09' });
    expect(chaseDue(dated, at('2026-11-07T20:00:00Z'))).toBe(false);
    expect(chaseDue(dated, at('2026-11-08T09:00:00Z'))).toBe(true);
    expect(chaseDue(dated, at('2026-11-09T09:00:00Z'))).toBe(true);
    expect(chaseDue(dated, at('2026-11-10T09:00:00Z'))).toBe(false);
    // Dated far ahead: it waits for its date, however long it has sat.
    expect(chaseDue(row({ until: '2026-11-13' }), at('2026-11-10T09:00:00Z'))).toBe(false);
  });

  it('a note with nothing to press is never chased', () => {
    expect(chaseDue(row({ actions: [] }), at('2026-11-09T12:00:00Z'))).toBe(false);
  });

  it('dated first, soonest first, then the oldest', () => {
    const rows = [row({ id: 'old' }), row({ id: 'late', until: '2026-11-12' }), row({ id: 'soon', until: '2026-11-10' }), row({ id: 'older', deliveredAt: new Date('2026-11-05T10:00:00Z') })];
    expect(rows.sort(chaseOrder).map((r) => r.id)).toEqual(['soon', 'late', 'older', 'old']);
  });
});

describe('the words', () => {
  it('a chase leads with the step and names the way out', () => {
    const t = chaseText(row({ until: '2026-11-10' }), '2026-11-10');
    expect(t.title).toBe('Still open: The bike has not shipped');
    expect(t.body).toContain(`One tap does it: ${reminder.label}.`);
    expect(t.body).toContain('Today is the last day for it.');
    expect(t.body).toContain('not for you');
    expect(t.body.startsWith('Ordered')).toBe(false);
  });

  it('the digest is due once, Sunday evening in London', () => {
    expect(digestDue(new Date('2026-11-15T18:30:00Z'), null)).toEqual({ due: true, week: '2026-11-15' });
    expect(digestDue(new Date('2026-11-15T18:30:00Z'), '2026-11-15').due).toBe(false);
    expect(digestDue(new Date('2026-11-15T17:30:00Z'), null).due).toBe(false);
    expect(digestDue(new Date('2026-11-14T19:00:00Z'), null).due).toBe(false);
    // BST: 17:30Z on a summer Sunday is 18:30 in London.
    expect(digestDue(new Date('2026-07-12T17:30:00Z'), null).due).toBe(true);
    expect(digestText(['a', 'b', 'c', 'd', 'e'], 5).body).toContain('…and 2 more on the feed.');
  });
});
