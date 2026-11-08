import { describe, expect, it } from 'vitest';
import { npFont, pencilFor, PENCILS, seedFor, tallyParts } from './paper';

describe('notes-paper helpers', () => {
  it('rules every measured face as itself, the inline-only faces as the nearest, and anything else as the reading face', () => {
    expect(npFont('read')).toBe('read');
    expect(npFont('body')).toBe('body');
    expect(npFont('mono')).toBe('mono');
    expect(npFont('display')).toBe('body');
    expect(npFont('brand')).toBe('mono');
    expect(npFont('toString')).toBe('read');
    expect(npFont('serif')).toBe('read');
    expect(npFont(undefined)).toBe('read');
  });

  it('gives a word the same pencil every time, whatever its case', () => {
    expect(pencilFor('Essays')).toBe(pencilFor('essays'));
    expect(pencilFor('craft')).toBeGreaterThanOrEqual(0);
    expect(pencilFor('craft')).toBeLessThan(PENCILS.length);
  });

  it('seeds the pen from a word, never with nought', () => {
    expect(seedFor('notes')).toBe(seedFor('notes'));
    expect(seedFor('')).toBeGreaterThan(0);
  });

  it('splits a count into gates of five and the strokes left over', () => {
    expect(tallyParts(11)).toEqual({ gates: 2, odd: 1 });
    expect(tallyParts(5)).toEqual({ gates: 1, odd: 0 });
    expect(tallyParts(-3)).toEqual({ gates: 0, odd: 0 });
  });
});
