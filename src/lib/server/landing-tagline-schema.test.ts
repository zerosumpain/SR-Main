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

  it.each([
    ['a line separator (U+2028)', 'one\u2028two'],
    ['a paragraph separator (U+2029)', 'one\u2029two'],
    ['a right-to-left override (U+202E)', 'abc\u202Edef'],
    ['a bidi isolate (U+2066)', 'abc\u2066def\u2069'],
    ['a zero-width space (U+200B)', 'zero\u200Bwidth'],
    ['a soft hyphen (U+00AD)', 'soft\u00ADhyphen'],
  ])('rejects %s', (_label, value) => {
    expect(landingTaglineSchema.safeParse(value).success).toBe(false);
  });

  it('keeps the zero-width joiner that emoji sequences need', () => {
    const family = 'Hi from \u{1F468}\u200D\u{1F469}\u200D\u{1F467} and \u{1F3F3}\uFE0F\u200D\u{1F308}';
    expect(landingTaglineSchema.parse(family)).toBe(family);
  });

  it.each([null, undefined, 42, { text: 'x' }])('rejects a non-string: %j', (value) => {
    expect(landingTaglineSchema.safeParse(value).success).toBe(false);
  });
});
