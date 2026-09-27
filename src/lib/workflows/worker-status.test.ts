import { describe, it, expect } from 'vitest';
import { parseWorkerStatus, WORKER_STATUS_MAX_AGE_MS } from './worker-status';
const snapshot = { version: 1, workerId: 'worker-a', observedAt: 100_000, jobs: [{ scheduleId: 's1', nextRunMs: 120_000, paused: false }] };
describe('worker scheduler status', () => {
  it('uses the worker registration rather than a local empty map', () => {
    expect(parseWorkerStatus(snapshot, 100_001)).toEqual({ available: true, snapshot });
  });
  it('distinguishes a fresh empty scheduler from missing, stale and malformed telemetry', () => {
    expect(parseWorkerStatus({ ...snapshot, jobs: [] }, 100_000).available).toBe(true);
    expect(parseWorkerStatus(undefined)).toEqual({ available: false, reason: 'missing' });
    expect(parseWorkerStatus(snapshot, 100_001 + WORKER_STATUS_MAX_AGE_MS)).toEqual({ available: false, reason: 'stale' });
    expect(parseWorkerStatus({ ...snapshot, jobs: [{}] }, 100_000)).toEqual({ available: false, reason: 'invalid' });
    expect(parseWorkerStatus({ ...snapshot, version: 2 }, 100_000)).toEqual({ available: false, reason: 'invalid' });
    expect(parseWorkerStatus(snapshot, 90_000)).toEqual({ available: false, reason: 'stale' });
  });
});
