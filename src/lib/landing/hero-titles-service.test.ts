import { describe, it, expect } from 'vitest';
import { validateGenerated } from './hero-titles-service';

describe('validateGenerated', () => {
  const good = {
    primary: 'still.',
    ghost: 'but plotting.',
    strap: '{bpm} beats, {steps} steps, {temp} of {sky} London.',
  };

  it('accepts a well-formed entry and upper-cases the headline', () => {
    const r = validateGenerated(good);
    expect(r).not.toBeNull();
    expect(r!.primary).toBe('STILL.');
    expect(r!.ghost).toBe('BUT PLOTTING.');
    expect(r!.strapTemplate).toBe(good.strap);
  });

  it('rejects a missing field', () => {
    expect(validateGenerated({ primary: 'A.', ghost: 'B.' })).toBeNull();
  });

  it('rejects digits in the headline', () => {
    expect(validateGenerated({ ...good, primary: '62 BPM.' })).toBeNull();
  });

  it('rejects digits in the strap', () => {
    expect(
      validateGenerated({ ...good, strap: '62 beats and {bpm} more.' }),
    ).toBeNull();
  });

  it('rejects a strap with no {bpm} token', () => {
    expect(
      validateGenerated({ ...good, strap: 'a quiet morning of {sky}.' }),
    ).toBeNull();
  });

  it('rejects an over-length headline', () => {
    expect(
      validateGenerated({ ...good, primary: 'A'.repeat(25) }),
    ).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(validateGenerated('nope')).toBeNull();
    expect(validateGenerated(null)).toBeNull();
  });
});
