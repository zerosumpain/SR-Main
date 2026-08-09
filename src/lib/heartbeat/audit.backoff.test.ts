import { describe, it, expect } from 'vitest';
import { backoffDelayMs, HEARTBEAT_BACKOFF_AFTER, HEARTBEAT_PAUSE_AFTER } from './audit';

const CADENCE = 30;

describe('backoffDelayMs', () => {
  it('leaves the cadence alone inside the free-failure allowance', () => {
    for (let f = 0; f <= HEARTBEAT_BACKOFF_AFTER; f++) {
      expect(backoffDelayMs(CADENCE, f)).toBe(CADENCE * 1000);
    }
  });

  it('doubles the interval per failure past the allowance', () => {
    expect(backoffDelayMs(CADENCE, HEARTBEAT_BACKOFF_AFTER + 1)).toBe(CADENCE * 1000 * 2);
    expect(backoffDelayMs(CADENCE, HEARTBEAT_BACKOFF_AFTER + 2)).toBe(CADENCE * 1000 * 4);
    expect(backoffDelayMs(CADENCE, HEARTBEAT_BACKOFF_AFTER + 3)).toBe(CADENCE * 1000 * 8);
  });

  it('never exceeds an hour, however long the action has been failing', () => {
    expect(backoffDelayMs(CADENCE, 50)).toBe(60 * 60 * 1000);
    expect(backoffDelayMs(1800, 50)).toBe(60 * 60 * 1000);
  });

  it('bounds the damage a permanently broken action can do before it is paused', () => {
    // The case this exists for: an action whose conversation had been deleted
    // logged 22,127 identical errors over nine days at full 30s cadence.
    // Under the budget it errors 10 times over roughly an hour and then parks.
    let elapsedMs = 0;
    for (let f = 1; f < HEARTBEAT_PAUSE_AFTER; f++) elapsedMs += backoffDelayMs(CADENCE, f);
    expect(HEARTBEAT_PAUSE_AFTER).toBe(10);
    expect(elapsedMs / 60_000).toBeGreaterThan(30);
    expect(elapsedMs / 60_000).toBeLessThan(120);
  });
});
