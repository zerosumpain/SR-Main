import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  publishJobEvent,
  subscribeJob,
  createJob,
  cleanOldJobs,
  createWaiter,
  cancelJob,
  respondToWaiter,
} from './job-store';
import type { JobEvent } from './job-store';

// Drain finished jobs + clear watchdog intervals after every test so Vitest's
// handle tracker stays clean across the whole file.
afterEach(() => {
  cleanOldJobs(0);
});

describe('job-store event schema', () => {
  it('accepts all new event variants without type error', () => {
    const { jobId } = createJob('test');
    const events: JobEvent[] = [
      { type: 'heartbeat', summary: 'Still working: fetching data', phase: 'thinking', elapsedMs: 30000 },
      { type: 'plan', plan: { steps: [{ id: 's1', title: 'x', detail: 'y' }], filesToTouch: [] }, planId: 'p1' },
      { type: 'plan_ack', planId: 'p1', decision: 'approved' },
      { type: 'confirm', confirmId: 'c1', prompt: 'Delete workflow?', destructive: true },
      { type: 'confirm_ack', confirmId: 'c1', decision: 'approved' },
      { type: 'clarify', clarifyId: 'q1', questions: [{ id: 'a', text: 'Which one?' }] },
      { type: 'clarify_ack', clarifyId: 'q1', answers: { a: 'that one' } },
      { type: 'subagent_start', agentId: 'a1', parentStepId: null, task: 'research x' },
      { type: 'subagent_event', agentId: 'a1', event: { type: 'token', delta: 'hi' } },
      { type: 'subagent_done', agentId: 'a1', summary: 'done', result: { ok: true } },
    ];
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));
    for (const e of events) publishJobEvent(jobId, e);
    expect(received.length).toBe(events.length);
  });
});

describe('job-store resumeWith', () => {
  it('suspends a waiter and resumes with payload', async () => {
    const { jobId } = createJob('test');
    const { awaitResponse, respond } = createWaiter<{ decision: string }>(jobId, 'plan:p1');
    setTimeout(() => respond({ decision: 'approved' }), 10);
    const result = await awaitResponse();
    expect(result).toEqual({ decision: 'approved' });
  });

  it('rejects waiter with the cancellation reason when job is cancelled', async () => {
    const { jobId } = createJob('test');
    const { awaitResponse } = createWaiter<{ decision: string }>(jobId, 'plan:p2');
    setTimeout(() => cancelJob(jobId), 10);
    await expect(awaitResponse()).rejects.toThrow('Cancelled by user');
  });

  it('respondToWaiter returns false when no waiter is registered', () => {
    const { jobId } = createJob('test');
    expect(respondToWaiter(jobId, 'missing:key', { x: 1 })).toBe(false);
  });
});

describe('heartbeat', () => {
  it('emits a heartbeat event after 25s of silence', async () => {
    vi.useFakeTimers();
    try {
      const { jobId } = createJob('test');
      const received: JobEvent[] = [];
      subscribeJob(jobId, (e) => received.push(e));
      vi.advanceTimersByTime(26_000);
      expect(received.some((e) => e.type === 'heartbeat')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits heartbeats at a fixed cadence even while tokens are flowing', async () => {
    // The heartbeat is fixed-cadence by design (job-store.ts): it fires
    // unconditionally while the job runs, independent of token activity.
    // The client deduplicates identical (phase, summary) ticks.
    vi.useFakeTimers();
    try {
      const { jobId } = createJob('test');
      const received: JobEvent[] = [];
      subscribeJob(jobId, (e) => received.push(e));
      for (let i = 0; i < 5; i++) {
        publishJobEvent(jobId, { type: 'token', delta: 'x' });
        vi.advanceTimersByTime(10_000);
      }
      expect(received.filter((e) => e.type === 'heartbeat').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('heartbeat event does not reset watchdog lastEventAt', () => {
    // Verify semantic: heartbeats are informational — they must NOT mask a
    // genuinely-stuck job from the idle-timeout watchdog.
    vi.useFakeTimers();
    try {
      const { jobId, job } = createJob('test');
      const received: JobEvent[] = [];
      subscribeJob(jobId, (e) => received.push(e));
      const before = job.lastEventAt;
      vi.advanceTimersByTime(26_000);
      // Assert heartbeat actually fired — otherwise the lastEventAt check
      // below is vacuously true and we'd miss a broken heartbeat path.
      expect(received.some((e) => e.type === 'heartbeat')).toBe(true);
      expect(job.lastEventAt).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('watchdog — delegations are busy, not idle', () => {
  it('does NOT reap a job past the 4-min idle limit while a delegate_task is in flight', () => {
    vi.useFakeTimers();
    try {
      const { jobId, job } = createJob('test');
      publishJobEvent(jobId, { type: 'tool_start', tool: 'delegate_task', args: { goal: 'x' } });
      expect(job.activeDelegations).toBe(1);
      expect(job.phase).toBe('subagent');
      // 5 min of parent silence — well past IDLE_TIMEOUT_MS (4 min).
      vi.advanceTimersByTime(300_000);
      expect(job.status).toBe('running');
      expect(job.abortController.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reverts to the normal idle limit once the delegation resolves', () => {
    vi.useFakeTimers();
    try {
      const { jobId, job } = createJob('test');
      publishJobEvent(jobId, { type: 'tool_start', tool: 'delegate_task', args: { goal: 'x' } });
      publishJobEvent(jobId, { type: 'tool_result', tool: 'delegate_task', result: 'ok', status: 'done' });
      expect(job.activeDelegations).toBe(0);
      expect(job.phase).toBe('thinking');
      // Now silent with no delegation → the normal 4-min watchdog applies.
      vi.advanceTimersByTime(300_000);
      expect(job.status).toBe('error');
      expect(job.abortController.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
