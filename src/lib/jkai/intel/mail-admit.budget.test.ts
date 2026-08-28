// The admit time budget.
//
// The bug: admission costs 27–50 SECONDS per thread, the site is behind a
// Cloudflare tunnel that abandons a request at 100 seconds, and one request for
// four threads therefore ran ~160s. The browser got a 524 while the server
// carried on admitting — so the mail landed, the page never refreshed, and it
// read as a total failure.
//
// These test the pure part of the fix: that work is bounded by TIME rather than
// count, and that what was not attempted comes back as ids the caller can
// re-send. `admitMailNotes` itself needs Gmail and a model, so what is checked
// here is the budget arithmetic that decides when to stop.
import { describe, it, expect } from 'vitest';

/** The loop's stopping rule, extracted verbatim from admitMailNotes. */
function planBatch(ids: string[], costMs: number, budgetMs: number) {
  const done: string[] = [];
  const remaining: string[] = [];
  let elapsed = 0;
  for (const id of ids) {
    if (elapsed >= budgetMs) {
      remaining.push(id);
      continue;
    }
    done.push(id);
    elapsed += costMs;
  }
  return { done, remaining };
}

describe('the admit time budget', () => {
  it('stops before the proxy would, on realistic per-thread cost', () => {
    // 40s each against a 60s budget: two threads start, and the second finishes
    // at ~80s — inside Cloudflare's 100s window, which is the point.
    const { done, remaining } = planBatch(['a', 'b', 'c', 'd'], 40_000, 60_000);
    expect(done).toEqual(['a', 'b']);
    expect(remaining).toEqual(['c', 'd']);
  });

  it('always attempts at least one thread, however slow', () => {
    // A budget smaller than a single thread must not return "nothing done,
    // everything remaining" — that is an infinite loop for the client.
    const { done, remaining } = planBatch(['a', 'b'], 90_000, 60_000);
    expect(done).toEqual(['a']);
    expect(remaining).toEqual(['b']);
  });

  it('does everything when the work fits', () => {
    const { done, remaining } = planBatch(['a', 'b', 'c'], 5_000, 60_000);
    expect(done).toEqual(['a', 'b', 'c']);
    expect(remaining).toEqual([]);
  });

  it('hands back ids, not a count, so the client cannot guess wrong', () => {
    const { remaining } = planBatch(['x', 'y', 'z'], 40_000, 60_000);
    expect(remaining).toEqual(['z']);
    expect(typeof remaining[0]).toBe('string');
  });

  it('drains in successive rounds, never losing or repeating a thread', () => {
    let queue = ['a', 'b', 'c', 'd', 'e'];
    const admitted: string[] = [];
    let rounds = 0;
    while (queue.length && rounds < 10) {
      const { done, remaining } = planBatch(queue, 40_000, 60_000);
      admitted.push(...done);
      queue = remaining;
      rounds += 1;
    }
    expect(admitted).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(new Set(admitted).size).toBe(5);
    expect(queue).toEqual([]);
  });
});
