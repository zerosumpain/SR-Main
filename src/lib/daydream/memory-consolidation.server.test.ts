import { describe, expect, it } from 'vitest';
import { consolidationLocalDay } from './memory-consolidation.server';

describe('consolidationLocalDay', () => {
  it('uses the Daydream Europe/London day across midnight and DST', () => {
    expect(consolidationLocalDay(new Date('2026-09-01T23:30:00Z'))).toBe('2026-09-02');
    expect(consolidationLocalDay(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-01');
  });
});
