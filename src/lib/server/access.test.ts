import { describe, it, expect } from 'vitest';
import { parseEmailList, emailInList } from './access-util';

describe('parseEmailList', () => {
  it('splits, trims, lower-cases and drops empties', () => {
    expect(parseEmailList(' A@x.com, b@Y.com ,, c@z.com ')).toEqual([
      'a@x.com',
      'b@y.com',
      'c@z.com',
    ]);
  });

  it('returns an empty array for undefined/empty input', () => {
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList('')).toEqual([]);
    expect(parseEmailList('   ')).toEqual([]);
  });
});

describe('emailInList', () => {
  const list = ['owner@x.com', 'guest@y.com'];

  it('matches case-insensitively', () => {
    expect(emailInList('Owner@X.com', list)).toBe(true);
    expect(emailInList(' guest@y.com ', list)).toBe(true);
  });

  it('rejects non-members and empty input', () => {
    expect(emailInList('nope@z.com', list)).toBe(false);
    expect(emailInList('', list)).toBe(false);
    expect(emailInList(null, list)).toBe(false);
    expect(emailInList(undefined, list)).toBe(false);
  });
});
