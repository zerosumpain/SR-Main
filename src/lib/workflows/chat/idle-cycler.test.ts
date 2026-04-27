import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startIdleCycler, stopIdleCycler, _internal } from './idle-cycler';

describe('idle-cycler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); stopIdleCycler(); });

  it('does not start when PULSE_DISABLED=1', () => {
    process.env.PULSE_DISABLED = '1';
    startIdleCycler();
    expect(_internal.timer()).toBeNull();
    delete process.env.PULSE_DISABLED;
  });

  it('does not start when NODE_ENV=test by default', () => {
    process.env.NODE_ENV = 'test';
    startIdleCycler();
    expect(_internal.timer()).toBeNull();
  });

  it('starts when forced via param even in test', () => {
    startIdleCycler({ force: true });
    expect(_internal.timer()).not.toBeNull();
  });

  it('skips a tick if a job is currently running', async () => {
    startIdleCycler({ force: true });
    _internal.setActiveJobs(1);
    const ran: string[] = [];
    _internal.setRunner(async () => { ran.push('ran'); return []; });
    await _internal.tickNow();
    expect(ran).toEqual([]);
  });

  it('skips a tick if last job ended within idleQuietMs', async () => {
    startIdleCycler({ force: true });
    _internal.setActiveJobs(0);
    _internal.setLastJobCompletedAt(Date.now() - 60_000);
    _internal.setIdleQuietMs(300_000);
    const ran: string[] = [];
    _internal.setRunner(async () => { ran.push('ran'); return []; });
    await _internal.tickNow();
    expect(ran).toEqual([]);
  });

  it('runs the runner when system is properly idle', async () => {
    startIdleCycler({ force: true });
    _internal.setActiveJobs(0);
    _internal.setLastJobCompletedAt(Date.now() - 600_000);
    _internal.setIdleQuietMs(300_000);
    const ran: string[] = [];
    _internal.setRunner(async () => { ran.push('ran'); return []; });
    await _internal.tickNow();
    expect(ran).toEqual(['ran']);
  });
});
