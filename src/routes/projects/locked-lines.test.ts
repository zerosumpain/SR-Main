import { describe, expect, it } from 'vitest';
import { LOCKED_LINES, pickLockedLine } from './locked-lines';

describe('the rambler at a locked card', () => {
  it('keeps to the voice card: lower case, no exclamation marks, no colons', () => {
    for (const { text } of LOCKED_LINES) {
      expect(text).not.toMatch(/[!:]/);
      expect(text).toBe(text.toLowerCase());
    }
  });

  it('says something short enough to read in a second and a half', () => {
    for (const { text } of LOCKED_LINES) expect(text.split(' ').length).toBeLessThanOrEqual(12);
  });

  it('picks from the whole list, ends included', () => {
    expect(pickLockedLine(0)).toBe(LOCKED_LINES[0]);
    expect(pickLockedLine(0.9999)).toBe(LOCKED_LINES.at(-1));
    expect(pickLockedLine(1)).toBe(LOCKED_LINES.at(-1));
  });
});
