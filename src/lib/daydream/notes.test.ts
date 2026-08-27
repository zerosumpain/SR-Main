import { describe, it, expect } from 'vitest';
import { MAX_NOTE_CHARS } from './notes';

describe('note limits', () => {
  it('leaves room for a real correction', () => {
    // "Good call, but some of those calendar events are rolling reminders" and
    // a paragraph of why has to fit; a tweet-length box would collect verdicts
    // again, which is the thing that already does not work.
    expect(MAX_NOTE_CHARS).toBeGreaterThanOrEqual(500);
  });

  it('stays short enough to remain one card in the pack', () => {
    expect(MAX_NOTE_CHARS).toBeLessThanOrEqual(2000);
  });
});
