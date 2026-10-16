import { describe, expect, it } from 'vitest';
import { REASONS, REASONS_AFTER, REASON_VERDICT, isDecline, reasonOf, tasteLines } from './reasons';

describe('reasons', () => {
  it('reads the stored code back, and the "did it" that Do it for me writes', () => {
    expect(reasonOf('already_knew')).toBe('already_knew');
    expect(reasonOf('did it')).toBe('did_it');
    expect(reasonOf('right about the heating')).toBeNull();
    expect(reasonOf(null)).toBeNull();
  });

  it('keeps "not now" out of the weights', () => {
    expect(REASON_VERDICT.not_now).toBeNull();
    expect(isDecline('not_now')).toBe(false);
    expect(isDecline('already_knew')).toBe(true);
  });

  it('offers every reason after one verdict or the other', () => {
    expect(new Set([...REASONS_AFTER.useful, ...REASONS_AFTER.not_useful])).toEqual(new Set(REASONS));
  });

  it('writes a taste block only when there is taste', () => {
    expect(tasteLines([])).toEqual([]);
    const lines = tasteLines([
      { title: 'Steps are up', reason: 'already_knew' },
      { title: 'Read Wild Mind tonight', reason: 'not_my_thing' },
    ]);
    expect(lines[0]).toMatch(/NOT WORTH SAYING/);
    expect(lines).toContain('  • He already knew: "Steps are up"');
    expect(lines).toContain('  • Not his thing: "Read Wild Mind tonight"');
  });
});
