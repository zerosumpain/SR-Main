import { describe, it, expect } from 'vitest';
import { shouldExtractAtTurn } from '$lib/jkai/intel/chat-extract';

// The cadence is the spend control on thread concept extraction: it puts an
// LLM call behind some turns and not others. Getting it wrong either bills a
// call per reply or never builds a graph at all.
describe('shouldExtractAtTurn', () => {
  it('does not fire on the first turn — one exchange rarely has a subject', () => {
    expect(shouldExtractAtTurn(0)).toBe(false);
    expect(shouldExtractAtTurn(1)).toBe(false);
  });

  it('fires on the second turn so a young thread still gets a graph', () => {
    expect(shouldExtractAtTurn(2)).toBe(true);
  });

  it('then fires every fourth turn, not every turn', () => {
    expect(shouldExtractAtTurn(3)).toBe(false);
    expect(shouldExtractAtTurn(4)).toBe(false);
    expect(shouldExtractAtTurn(5)).toBe(false);
    expect(shouldExtractAtTurn(6)).toBe(true);
    expect(shouldExtractAtTurn(10)).toBe(true);
    expect(shouldExtractAtTurn(14)).toBe(true);
  });

  it('stays sparse over a long thread', () => {
    const fired = Array.from({ length: 60 }, (_, i) => shouldExtractAtTurn(i)).filter(Boolean);
    // 60 turns must not mean 60 extraction calls.
    expect(fired.length).toBeLessThanOrEqual(15);
  });
});
