import { describe, expect, it } from 'vitest';
import { localDayStart, tzOffsetMins } from './types';

describe('tzOffsetMins', () => {
  it('reads GMT as 0 and BST as 60', () => {
    expect(tzOffsetMins(new Date('2026-01-15T12:00:00Z'))).toBe(0);
    expect(tzOffsetMins(new Date('2026-07-15T12:00:00Z'))).toBe(60);
  });
});

describe('localDayStart', () => {
  it('is local midnight under BST and GMT', () => {
    expect(localDayStart(new Date('2026-08-26T12:00:00Z')).toISOString()).toBe('2026-08-25T23:00:00.000Z');
    expect(localDayStart(new Date('2026-01-15T12:00:00Z')).toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('is right on the spring change day (29 Mar 2026 began in GMT)', () => {
    // After the change (BST), and before it.
    expect(localDayStart(new Date('2026-03-29T11:00:00Z')).toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(localDayStart(new Date('2026-03-29T00:30:00Z')).toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(localDayStart(new Date('2026-03-29T22:59:00Z')).toISOString()).toBe('2026-03-29T00:00:00.000Z');
  });

  it('is right on the autumn change day (25 Oct 2026 began in BST)', () => {
    expect(localDayStart(new Date('2026-10-25T12:00:00Z')).toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(localDayStart(new Date('2026-10-24T23:30:00Z')).toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(localDayStart(new Date('2026-10-25T23:59:00Z')).toISOString()).toBe('2026-10-24T23:00:00.000Z');
    // The day after is an ordinary GMT day again.
    expect(localDayStart(new Date('2026-10-26T12:00:00Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
});
