// src/lib/canvas/intelligence/desk/coalesce.test.ts
//
// Unit tests for makeCoalescer — trailing debounce with max-wait.
// All timer assertions use vitest fake timers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeCoalescer } from './coalesce';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('makeCoalescer', () => {
  it('(a) a burst of N rapid schedule() calls within maxMs fires fn exactly once (after idle settles)', () => {
    const fn = vi.fn();
    const { schedule } = makeCoalescer({ idleMs: 16, maxMs: 120 }, fn);

    // Rapid burst: 10 calls, each 5ms apart (total 50ms < maxMs 120ms)
    for (let i = 0; i < 10; i++) {
      schedule();
      vi.advanceTimersByTime(5);
    }

    // Still within idleMs of the last call — should NOT have fired yet
    expect(fn).not.toHaveBeenCalled();

    // Advance past idle window (16ms)
    vi.advanceTimersByTime(16);

    // Should have fired exactly once
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('(b) a single schedule() then idle fires fn once after ~idleMs', () => {
    const fn = vi.fn();
    const { schedule } = makeCoalescer({ idleMs: 16, maxMs: 120 }, fn);

    schedule();

    // Not yet
    vi.advanceTimersByTime(15);
    expect(fn).not.toHaveBeenCalled();

    // Advance past idleMs
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('(c) continuous scheduling longer than maxMs fires fn at least every ~maxMs (latency bounded)', () => {
    const fn = vi.fn();
    const { schedule } = makeCoalescer({ idleMs: 16, maxMs: 120 }, fn);

    // Schedule calls every 5ms for 250ms — far longer than maxMs=120ms
    // This simulates a heavy streaming run
    const totalMs = 250;
    const interval = 5;
    const steps = totalMs / interval;

    for (let i = 0; i < steps; i++) {
      schedule();
      vi.advanceTimersByTime(interval);
    }

    // Should have fired at least twice (once around 120ms, once later)
    // Not 200 times (which would be the 5ms-leading-edge behavior)
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fn.mock.calls.length).toBeLessThan(20); // definitely not ~200/sec
  });

  it('(d) flushNow() runs immediately and cancels pending idle timer', () => {
    const fn = vi.fn();
    const { schedule, flushNow } = makeCoalescer({ idleMs: 16, maxMs: 120 }, fn);

    schedule();
    expect(fn).not.toHaveBeenCalled();

    // flushNow should call fn immediately
    flushNow();
    expect(fn).toHaveBeenCalledTimes(1);

    // Advancing past idle should NOT fire again (was cancelled)
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('(e) cancel() prevents a pending flush from firing', () => {
    const fn = vi.fn();
    const { schedule, cancel } = makeCoalescer({ idleMs: 16, maxMs: 120 }, fn);

    schedule();
    cancel();

    // Advance well past idle — should not fire
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it('after flushNow(), a subsequent schedule() arms a fresh idle timer', () => {
    const fn = vi.fn();
    const { schedule, flushNow } = makeCoalescer({ idleMs: 16, maxMs: 120 }, fn);

    schedule();
    flushNow();
    expect(fn).toHaveBeenCalledTimes(1);

    // New schedule after flushNow — should work normally
    schedule();
    vi.advanceTimersByTime(16);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('maxMs resets after a flush so latency stays bounded across multiple runs', () => {
    const fn = vi.fn();
    const { schedule } = makeCoalescer({ idleMs: 16, maxMs: 120 }, fn);

    // First wave: continuous for 130ms → should fire once around 120ms
    for (let i = 0; i < 26; i++) {
      schedule();
      vi.advanceTimersByTime(5);
    }
    const countAfterFirstWave = fn.mock.calls.length;
    expect(countAfterFirstWave).toBeGreaterThanOrEqual(1);

    // Idle gap — ensure any pending flushes settle
    vi.advanceTimersByTime(20);
    const countAfterIdle = fn.mock.calls.length;

    // Second wave: continuous for another 130ms → should fire at least once more
    for (let i = 0; i < 26; i++) {
      schedule();
      vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(20);

    expect(fn.mock.calls.length).toBeGreaterThan(countAfterIdle);
  });
});
