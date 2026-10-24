// Harness mode makes no network calls (spec §9.16, WP6's acceptance list):
// fetch, XMLHttpRequest and WebSocket are replaced by throwing stubs while a
// county is created, founded and played, so any call would fail the test.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const saved: Record<string, unknown> = {};
const NAMES = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'] as const;

beforeAll(() => {
  for (const n of NAMES) {
    saved[n] = (globalThis as Record<string, unknown>)[n];
    (globalThis as Record<string, unknown>)[n] = function blocked() {
      throw new Error(`harness mode called ${n}`);
    };
  }
});
afterAll(() => {
  for (const n of NAMES) (globalThis as Record<string, unknown>)[n] = saved[n];
});

describe('harness mode offline', () => {
  it('creates, founds and plays two days with every network door shut', async () => {
    const { HarnessSession } = await import('../src/harness/session');
    const s = new HarnessSession({ seed: 5, site: 1 });
    s.runDays(2);
    expect(s.stats().population).toBeGreaterThan(0);
    expect(s.county.dayIndex).toBeGreaterThanOrEqual(1); // sprint ticks are off the grid, so two town days span one Regional Day or two
  });

  it('runs whole ticks under a frame budget and stops when the budget is spent', async () => {
    const { HarnessSession } = await import('../src/harness/session');
    const s = new HarnessSession({ seed: 5 });
    let fake = 0;
    const ran = s.run(100, 10, () => (fake += 4)); // each clock read "takes" 4 ms
    expect(ran).toBeGreaterThan(0);
    expect(ran).toBeLessThan(100);
    expect(s.run(5)).toBe(5);
  });
});
