import { describe, it, expect } from 'vitest';
import { shouldStamp, DEFAULT_BATCH, NOMINATIM_MIN_INTERVAL_MS, SUGGESTION_TTL_DAYS } from './suggest';

describe('shouldStamp', () => {
  // The failure this guards against is silent and slow: the queue looks like it
  // is working, and is in fact stuck on the same thirty places forever.
  it('stamps a real name so it is not looked up again', () => {
    expect(shouldStamp('nominatim')).toBe(true);
  });

  it('stamps a cache hit', () => {
    expect(shouldStamp('cache')).toBe(true);
  });

  // The one that matters, and the reason this is a function rather than an
  // inline `!==`. A successful lookup that resolved to nothing IS an answer:
  // it is keyed on the SOURCE, not on whether a name came back, so the places
  // that can never resolve — a lay-by, a field edge, a bad fix — stop being
  // retried and stop crowding out the ones that would resolve.
  it('does NOT stamp an outage, so a nameable place is not silenced for months', () => {
    expect(shouldStamp('unavailable')).toBe(false);
  });
});

describe('suggestion budget', () => {
  // Nominatim's published policy is one request per second, absolute. Going
  // under it risks the IP, and the whole naming flow degrades to "no
  // suggestions" if that happens.
  it('leaves at least a second between requests', () => {
    expect(NOMINATIM_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
  });

  // A run has to stay a comfortable fraction of the hourly cadence, or a slow
  // batch overlaps the next tick.
  it('keeps one run well inside the hour', () => {
    const worstCaseMs = DEFAULT_BATCH * NOMINATIM_MIN_INTERVAL_MS;
    expect(worstCaseMs).toBeLessThan(300_000);
  });

  it('does not re-ask about a place for months', () => {
    expect(SUGGESTION_TTL_DAYS).toBeGreaterThanOrEqual(30);
  });
});
