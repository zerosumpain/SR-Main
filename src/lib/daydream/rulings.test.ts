import { describe, expect, it } from 'vitest';
import { MAX_RULING_CHARS, rulingContent } from './rulings';

const base = {
  kind: 'spend_duplicate',
  title: 'You were charged twice for Canva',
  likelihood: 0.05,
  reasoning: 'The invoice and the bank line are the same payment seen from two sides.',
  sources: ['mail_read({"noteId":"n1"})', 'datastore_query'],
};

describe('rulingContent', () => {
  it('quotes the claim, so the memory is intelligible on its own months later', () => {
    const out = rulingContent({ ...base, verdict: 'refuted' });
    expect(out).toContain('“You were charged twice for Canva”');
    expect(out).toContain('(spend_duplicate)');
  });

  it('says a refutation in words, and says not to raise it again', () => {
    const out = rulingContent({ ...base, verdict: 'refuted' });
    expect(out).toContain('does NOT hold');
    expect(out).toContain('do not raise this again');
    expect(out).not.toMatch(/^refuted/i);
  });

  it('records confirmations in the same shape — a pack of only mistakes teaches timidity', () => {
    const out = rulingContent({ ...base, verdict: 'verified', likelihood: 0.92 });
    expect(out).toContain('it holds up');
    expect(out).toContain('92%');
  });

  it('says plainly when the sources could not settle it', () => {
    const out = rulingContent({ ...base, verdict: 'uncertain', likelihood: 0.5 });
    expect(out).toContain('could not settle it');
  });

  it('names what was checked, and says so when nothing was', () => {
    expect(rulingContent({ ...base, verdict: 'refuted' })).toContain('Checked: mail_read');
    expect(rulingContent({ ...base, verdict: 'refuted', sources: [] })).toContain(
      'Nothing external was read',
    );
    expect(rulingContent({ ...base, verdict: 'refuted', sources: ['  ', ''] })).toContain(
      'Nothing external was read',
    );
  });

  it('caps the sources so one chatty review cannot fill the card', () => {
    const many = Array.from({ length: 20 }, (_, i) => `tool_${i}`);
    const out = rulingContent({ ...base, verdict: 'refuted', sources: many });
    expect(out).toContain('tool_5');
    expect(out).not.toContain('tool_6');
  });

  it('omits the probability when there is not a real number', () => {
    const out = rulingContent({ ...base, verdict: 'refuted', likelihood: null });
    expect(out).not.toContain('Probability');
    expect(rulingContent({ ...base, verdict: 'refuted', likelihood: Number.NaN })).not.toContain(
      'Probability',
    );
  });

  it('survives an empty reasoning without printing a double space or a stray full stop', () => {
    const out = rulingContent({ ...base, verdict: 'refuted', reasoning: '   ' });
    expect(out).not.toContain('  ');
    expect(out).toContain('do not raise this again');
  });

  it('is capped, so one runaway review cannot write a page into the pack', () => {
    const out = rulingContent({
      ...base,
      verdict: 'refuted',
      reasoning: 'x'.repeat(5_000),
    });
    expect(out.length).toBeLessThanOrEqual(MAX_RULING_CHARS);
  });
});
