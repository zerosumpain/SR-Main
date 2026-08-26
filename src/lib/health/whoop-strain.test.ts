import { describe, it, expect } from 'vitest';
import { realStrain } from './whoop';

// Values taken from the 2026-08-26 audit of whoop_cycles: 51 rows held
// round(strain x 100) while 194 held honest doubles, interleaved daily, with
// nothing on the row to tell them apart.
describe('realStrain', () => {
  it('leaves a genuine reading alone', () => {
    expect(realStrain(1.12)).toBeCloseTo(1.12);
    expect(realStrain(11.032608)).toBeCloseTo(11.032608);
    expect(realStrain(20.33)).toBeCloseTo(20.33);
  });

  it('unscales the values that were actually in the table', () => {
    expect(realStrain(145)).toBeCloseTo(1.45);
    expect(realStrain(1103)).toBeCloseTo(11.03);
    expect(realStrain(2033)).toBeCloseTo(20.33);
    expect(realStrain(889)).toBeCloseTo(8.89);
  });

  // The boundary that makes the rule safe at all. Strain caps at 21, so a
  // reading of 21 is legitimate and must not become 0.21.
  it('does not unscale a legitimate maximum', () => {
    expect(realStrain(21)).toBe(21);
    expect(realStrain(22)).toBe(22);
  });

  it('is idempotent, so a double application cannot halve a value again', () => {
    expect(realStrain(realStrain(1103))).toBeCloseTo(11.03);
  });
});
