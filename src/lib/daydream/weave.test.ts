import { describe, expect, it } from 'vitest';
import { weaveHash, weaveText, type WeavableThought } from './weave';

const thought: WeavableThought = {
  id: 't1',
  kind: 'spend_duplicate',
  title: 'Canva has taken two payments this month',
  explanation: 'Two rows in the spend ledger name Canva within four days of each other.',
  narrative: 'Canva looks like it billed you twice in August.',
  note: null,
  reviewVerdict: null,
  reviewReasoning: null,
  evidence: [],
};

describe('weaveText', () => {
  it('leads with the title, so the extractor reads a name before a number', () => {
    expect(weaveText(thought, []).startsWith('Canva has taken two payments this month')).toBe(true);
  });

  it('carries the prose the names actually live in', () => {
    const out = weaveText(thought, []);
    expect(out).toContain('Two rows in the spend ledger');
    expect(out).toContain('Canva looks like it billed you twice');
  });

  it("includes John's own words when he left any", () => {
    const out = weaveText({ ...thought, note: 'That is the annual plan, not a duplicate.' }, []);
    expect(out).toContain('John said: That is the annual plan, not a duplicate.');
  });

  it('carries the reviewer verdict only when there is reasoning behind it', () => {
    const withBoth = weaveText(
      { ...thought, reviewVerdict: 'refuted', reviewReasoning: 'One payment, two systems.' },
      [],
    );
    expect(withBoth).toContain('found it refuted: One payment, two systems.');

    const verdictOnly = weaveText({ ...thought, reviewVerdict: 'refuted' }, []);
    expect(verdictOnly).not.toContain('A reviewer checked');
  });

  it('appends the evidence lines, which is where the proper nouns usually are', () => {
    const out = weaveText(thought, ['- Canva Pty Ltd: £12.99 on 2026-08-04']);
    expect(out).toContain('What it rests on:');
    expect(out).toContain('Canva Pty Ltd');
  });

  it('leaves no blank section when everything optional is absent', () => {
    const out = weaveText(thought, []);
    expect(out).not.toContain('What it rests on');
    expect(out).not.toMatch(/\n{3,}/);
    expect(out.trim()).toBe(out);
  });
});

describe('weaveHash', () => {
  it('is stable for the same text, so re-voting costs no model call', () => {
    expect(weaveHash('abc')).toBe(weaveHash('abc'));
  });

  it('changes when the text does, so a note added later re-extracts', () => {
    const before = weaveHash(weaveText(thought, []));
    const after = weaveHash(weaveText({ ...thought, note: 'annual plan' }, []));
    expect(after).not.toBe(before);
  });

  it('is short enough to sit in a metadata field', () => {
    expect(weaveHash('abc')).toHaveLength(32);
  });
});
