import { describe, it, expect } from 'vitest';
import { MAX_NOTES, parseReply, slugOf, validateThinkOutput } from './audit';
import { makeCard, type Card } from './tools';

function cards(...ids: number[]): Map<string, Card> {
  const m = new Map<string, Card>();
  for (const n of ids) {
    const c = makeCard(n, n === 1 ? 'spend' : 'diary', { n }, `card ${n} text`, '2026-09-25');
    m.set(c.id, c);
  }
  return m;
}

const note = (over: Record<string, unknown> = {}) => ({
  outcome: 'money_analysis',
  title: 'Canva charged twice on 28 August',
  body: 'Two Canva rows of £12.99 landed on 28 August, one day apart from the renewal date in your diary.',
  cites: ['C1', 'C2'],
  ...over,
});

describe('validateThinkOutput', () => {
  it('keeps a note whose every citation was issued', () => {
    const out = validateThinkOutput({ notes: [note()] }, cards(1, 2));
    expect(out.notes).toHaveLength(1);
    expect(out.rejected).toEqual([]);
    const n = out.notes[0];
    expect(n.candidate.kind).toBe('think_money_analysis');
    expect(n.candidate.dedupeKey).toBe('think:money_analysis:canva-charged-twice-on-28-august');
    expect(n.candidate.evidence.map((e) => e.kind)).toEqual(['think-card', 'think-card']);
  });

  it('kills a note WHOLE when one citation was never issued', () => {
    // The audit. One real card does not launder an invented one.
    const out = validateThinkOutput({ notes: [note({ cites: ['C1', 'C9'] })] }, cards(1, 2));
    expect(out.notes).toEqual([]);
    expect(out.citationDrops).toBe(1);
    expect(out.rejected[0]).toMatch(/unissued cards C9/);
  });

  it('kills a note with no citations at all', () => {
    const out = validateThinkOutput({ notes: [note({ cites: [] })] }, cards(1));
    expect(out.notes).toEqual([]);
    expect(out.citationDrops).toBe(1);
  });

  it('reads a citation echoed in its rendered brackets', () => {
    const out = validateThinkOutput({ notes: [note({ cites: ['[C1]', '`C2`'] })] }, cards(1, 2));
    expect(out.notes[0].citedCardIds).toEqual(['C1', 'C2']);
  });

  it('caps the notes a cycle may write', () => {
    const many = Array.from({ length: 4 }, (_, i) => note({ title: `A specific finding number ${i}` }));
    const out = validateThinkOutput({ notes: many }, cards(1, 2));
    expect(out.notes).toHaveLength(MAX_NOTES);
    expect(out.rejected.filter((r) => /cap/.test(r))).toHaveLength(4 - MAX_NOTES);
  });

  it('refuses an outcome the cycle may not write', () => {
    const out = validateThinkOutput({ notes: [note()] }, cards(1, 2), { allowedOutcomes: ['research', 'suggest'] });
    expect(out.notes).toEqual([]);
    expect(out.rejected[0]).toMatch(/not allowed/);
  });

  it('refuses a body too short to say anything', () => {
    const out = validateThinkOutput({ notes: [note({ body: 'Busy day.' })] }, cards(1, 2));
    expect(out.notes).toEqual([]);
  });

  it('treats an empty answer as a good answer', () => {
    const out = validateThinkOutput({ notes: [] }, cards(1));
    expect(out.notes).toEqual([]);
    expect(out.rejected).toEqual([]);
  });

  it('carries the action through', () => {
    const out = validateThinkOutput({ notes: [note({ action: 'Ask Canva to refund the duplicate.' })] }, cards(1, 2));
    expect(out.notes[0].action).toBe('Ask Canva to refund the duplicate.');
  });
});

describe('parseReply', () => {
  it('reads a fenced block', () => {
    expect(parseReply('```json\n{"notes":[]}\n```')).toEqual({ notes: [] });
  });

  it('reads an object after a stray sentence', () => {
    expect(parseReply('Here you go: {"notes":[]}')).toEqual({ notes: [] });
  });

  it('returns null for prose', () => {
    expect(parseReply('Nothing worth saying today.')).toBeNull();
  });
});

describe('slugOf', () => {
  it('is stable and bounded', () => {
    expect(slugOf('Heating ran at 23°C all night!')).toBe('heating-ran-at-23-c-all-night');
    expect(slugOf('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
