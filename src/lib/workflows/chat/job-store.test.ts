import { describe, it, expect, afterEach } from 'vitest';
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
      { type: 'heartbeat', summary: 'Still working: fetching data', elapsedMs: 30000 },
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
