import { describe, expect, it } from 'vitest';
import { landingTaglineSchema } from './landing-tagline-schema';
import { DEFAULT_LANDING_TAGLINE, LANDING_TAGLINE_MAX } from '$lib/constants/landing-tagline';

describe('landing tagline schema', () => {
  it('trims the line', () => {
    expect(landingTaglineSchema.parse('   I say things.  ')).toBe('I say things.');
  });

  it('reads blank and whitespace-only as empty, which the caller treats as reset', () => {
    expect(landingTaglineSchema.parse('')).toBe('');
    expect(landingTaglineSchema.parse('    ')).toBe('');
  });

  it('caps the length after trimming', () => {
    const atCap = 'x'.repeat(LANDING_TAGLINE_MAX);
    expect(landingTaglineSchema.parse(`  ${atCap}  `)).toBe(atCap);
    expect(landingTaglineSchema.safeParse(atCap + 'x').success).toBe(false);
  });

  it('accepts the built-in default', () => {
    expect(landingTaglineSchema.parse(DEFAULT_LANDING_TAGLINE)).toBe(DEFAULT_LANDING_TAGLINE);
  });

  it('lets curly quotes and apostrophes through untouched', () => {
    const line = 'JK’s line — “quoted”, ‘single’ & <not markup>';
    expect(landingTaglineSchema.parse(line)).toBe(line);
  });

  it.each(['one\ntwo', 'tab\there', 'nul\u0000'])('rejects control characters: %j', (value) => {
    expect(landingTaglineSchema.safeParse(value).success).toBe(false);
  });

  it.each([null, undefined, 42, { text: 'x' }])('rejects a non-string: %j', (value) => {
    expect(landingTaglineSchema.safeParse(value).success).toBe(false);
  });
});
