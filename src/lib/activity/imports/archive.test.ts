import { describe, expect, it } from 'vitest';
import { hasZipMagic } from './archive';

describe('activity archive validation', () => {
  it.each([
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ])('accepts a ZIP signature', (...signature) => {
    expect(hasZipMagic(Uint8Array.from(signature))).toBe(true);
  });

  it('does not trust a filename without ZIP magic bytes', () => {
    expect(hasZipMagic(new TextEncoder().encode('not actually a zip'))).toBe(false);
  });
});
