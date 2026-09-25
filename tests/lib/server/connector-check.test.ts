import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CHECK_DEBOUNCE_MS,
  CHECK_MIN_GAP_MS,
  _resetConnectorCheckForTests,
  noteConnectorCheckRan,
  registerConnectorCheck,
  requestConnectorCheck,
} from '$lib/server/connector-check';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-25T07:40:00.000Z'));
  _resetConnectorCheckForTests();
});
afterEach(() => {
  _resetConnectorCheckForTests();
  vi.useRealTimers();
});

describe('requestConnectorCheck', () => {
  it('is a no-op when no watcher is registered in this process', () => {
    expect(requestConnectorCheck()).toBe(false);
  });

  it('coalesces a burst of requests into one check, a minute later', async () => {
    const run = vi.fn(async () => {});
    registerConnectorCheck(run);
    for (let i = 0; i < 10; i++) expect(requestConnectorCheck('gmail invalid_grant')).toBe(true);
    await vi.advanceTimersByTimeAsync(CHECK_DEBOUNCE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits out the minimum gap after a check that just ran', async () => {
    const run = vi.fn(async () => {});
    registerConnectorCheck(run);
    noteConnectorCheckRan(Date.now());
    requestConnectorCheck();
    await vi.advanceTimersByTimeAsync(CHECK_DEBOUNCE_MS);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHECK_MIN_GAP_MS - CHECK_DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('accepts a new request once the previous one has run', async () => {
    const run = vi.fn(async () => {});
    registerConnectorCheck(run);
    requestConnectorCheck();
    await vi.advanceTimersByTimeAsync(CHECK_DEBOUNCE_MS);
    requestConnectorCheck();
    await vi.advanceTimersByTimeAsync(CHECK_MIN_GAP_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('drops a pending request when the watcher withdraws', async () => {
    const run = vi.fn(async () => {});
    registerConnectorCheck(run);
    requestConnectorCheck();
    registerConnectorCheck(null);
    await vi.advanceTimersByTimeAsync(CHECK_MIN_GAP_MS);
    expect(run).not.toHaveBeenCalled();
  });

  it('swallows a failing check', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerConnectorCheck(async () => {
      throw new Error('boom');
    });
    requestConnectorCheck();
    await vi.advanceTimersByTimeAsync(CHECK_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
