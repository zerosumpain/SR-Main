import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  publishJobEvent,
  subscribeJob,
  createJob,
  cleanOldJobs,
  createWaiter,
  cancelJob,
  cancelForScope,
  listJobs,
  markJobQueued,
  clearJobQueued,
  whenJobSettles,
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

describe('job-store subscriber resume', () => {
  it('replays only what a reconnecting subscriber missed', () => {
    const { jobId } = createJob('test');
    const first: JobEvent[] = [];
    const seqs: number[] = [];
    const unsub = subscribeJob(jobId, (e, seq) => { first.push(e); seqs.push(seq); });
    publishJobEvent(jobId, { type: 'token', delta: 'Hello ' });
    publishJobEvent(jobId, { type: 'token', delta: 'world' });
    unsub();
    // Client dropped here having seen up to `seqs.at(-1)`; more arrives while
    // it is away.
    publishJobEvent(jobId, { type: 'token', delta: '!' });

    const resumed: JobEvent[] = [];
    subscribeJob(jobId, (e) => resumed.push(e), seqs[seqs.length - 1] + 1);
    expect(resumed).toEqual([{ type: 'token', delta: '!' }]);
    // Appending both handlers' deltas reconstructs the reply exactly once —
    // a full replay would have produced "Hello worldHello world!".
    expect([...first, ...resumed].map((e) => (e as { delta: string }).delta).join('')).toBe('Hello world!');
  });

  it('still replays everything for a fresh subscriber', () => {
    const { jobId } = createJob('test');
    publishJobEvent(jobId, { type: 'token', delta: 'a' });
    publishJobEvent(jobId, { type: 'token', delta: 'b' });
    const received: JobEvent[] = [];
    subscribeJob(jobId, (e) => received.push(e));
    expect(received.length).toBe(2);
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

  it('does NOT reap a job past the 10-min hard limit while an ordinary tool call is in flight', () => {
    vi.useFakeTimers();
    try {
      const { jobId, job } = createJob('test');
      publishJobEvent(jobId, { type: 'tool_start', tool: 'workflow_run', args: {} });
      expect(job.activeTools).toBe(1);
      expect(job.phase).toBe('tool_running');
      // 16 min of silence — the shape of the canvas run that used to be reaped
      // at 4 min while Hermes was still working.
      vi.advanceTimersByTime(960_000);
      expect(job.status).toBe('running');
      expect(job.abortController.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reverts to the normal idle limit once the tool call resolves', () => {
    vi.useFakeTimers();
    try {
      const { jobId, job } = createJob('test');
      publishJobEvent(jobId, { type: 'tool_start', tool: 'workflow_run', args: {} });
      publishJobEvent(jobId, { type: 'tool_result', tool: 'workflow_run', result: 'ok', status: 'done' });
      expect(job.activeTools).toBe(0);
      expect(job.phase).toBe('thinking');
      vi.advanceTimersByTime(300_000);
      expect(job.status).toBe('error');
      expect(job.abortController.signal.aborted).toBe(true);
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

  it("keeps reporting 'subagent' when an ordinary tool runs inside a delegation", () => {
    const { jobId, job } = createJob('test');
    publishJobEvent(jobId, { type: 'tool_start', tool: 'delegate_task', args: { goal: 'x' } });
    expect(job.phase).toBe('subagent');
    // A sub-agent's own tool calls arrive on the parent job. They must not
    // claim the phase, or the first one to finish reports 'thinking' while the
    // sub-agent is still working — wrong in the heartbeat and in the reap
    // message's phase label.
    publishJobEvent(jobId, { type: 'tool_start', tool: 'gmail_search', args: {} });
    expect(job.phase).toBe('subagent');
    publishJobEvent(jobId, { type: 'tool_result', tool: 'gmail_search', result: 'ok', status: 'done' });
    expect(job.activeTools).toBe(0);
    expect(job.phase).toBe('subagent');
    publishJobEvent(jobId, { type: 'tool_result', tool: 'delegate_task', result: 'ok', status: 'done' });
    expect(job.phase).toBe('thinking');
  });

  it("falls back to 'subagent' when a delegation starts mid tool call", () => {
    const { jobId, job } = createJob('test');
    publishJobEvent(jobId, { type: 'tool_start', tool: 'workflow_run', args: {} });
    expect(job.phase).toBe('tool_running');
    publishJobEvent(jobId, { type: 'tool_start', tool: 'delegate_task', args: { goal: 'x' } });
    expect(job.phase).toBe('subagent');
    publishJobEvent(jobId, { type: 'tool_result', tool: 'workflow_run', result: 'ok', status: 'done' });
    // The delegation is still live, so the phase must not drop to 'thinking'.
    expect(job.phase).toBe('subagent');
  });
});


describe('cancelForScope — reporting what was superseded', () => {
  it('names the jobs it cancelled, not just how many', () => {
    // The newest job has to adopt the turn ids it superseded. A second message
    // while the agent is answering does not start a second Hermes run: the
    // running one is redirected (or the text merged into it) and keeps the FIRST
    // turn's stamp, so without these ids the newest job rejects the output that
    // is answering it. A count cannot carry that.
    const a = createJob('first', { conversationId: 'conv-1' });
    const b = createJob('second', { conversationId: 'conv-1' });
    const elsewhere = createJob('other', { conversationId: 'conv-2' });

    const superseded = cancelForScope({ conversationId: 'conv-1' }, 'Superseded by new request');

    expect(new Set(superseded)).toEqual(new Set([a.jobId, b.jobId]));
    expect(superseded).not.toContain(elsewhere.jobId);
    cancelJob(elsewhere.jobId);
  });

  it('returns an empty list when nothing matched', () => {
    expect(cancelForScope({ conversationId: 'conv-nothing' }, 'why not')).toEqual([]);
  });

  it('returns an empty list for an unscoped call rather than cancelling everything', () => {
    const j = createJob('keep me', { conversationId: 'conv-3' });
    expect(cancelForScope({}, 'no scope')).toEqual([]);
    cancelJob(j.jobId);
  });
});


describe('whenJobSettles — serialising a queued turn behind a running one', () => {
  it('resolves when the job it waits on stops running', async () => {
    // The tool-step bus keys its confirmer and its listeners by CHAT, on the
    // documented assumption that a chat has one live job at a time — an
    // assumption `cancelForScope` used to guarantee. With the gateway queueing we
    // no longer cancel, so the queued turn has to hold here instead of
    // registering a confirmer that would answer for the turn ahead of it.
    const ahead = createJob('first', { conversationId: 'conv-q' });
    let settled = false;
    const wait = whenJobSettles(ahead.jobId).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    cancelJob(ahead.jobId);
    await wait;
    expect(settled).toBe(true);
  });

  it('resolves immediately for a job that is already gone', async () => {
    // Its turn finished between us reading the running-job map and getting here.
    await expect(whenJobSettles('no-such-job')).resolves.toBeUndefined();
  });

  it('does not wait on a job that already finished', async () => {
    const j = createJob('done already', { conversationId: 'conv-q2' });
    cancelJob(j.jobId);
    await expect(whenJobSettles(j.jobId)).resolves.toBeUndefined();
  });

  it('reports a queued turn as waiting, not stuck', () => {
    // A queued turn is silent for exactly as long as the turn ahead of it runs,
    // which the 4-min idle watchdog reads as stuck. The flag is what exempts it,
    // and surfacing it means an operator reading the running-job list can tell
    // the two apart.
    const ahead = createJob('ahead', { conversationId: 'conv-q3' });
    const behind = createJob('behind', { conversationId: 'conv-q3' });
    markJobQueued(behind.jobId, ahead.jobId);

    const listed = listJobs().find((j) => j.id === behind.jobId);
    expect(listed?.queuedBehind).toBe(ahead.jobId);
    expect(listJobs().find((j) => j.id === ahead.jobId)?.queuedBehind).toBeNull();

    clearJobQueued(behind.jobId);
    expect(listJobs().find((j) => j.id === behind.jobId)?.queuedBehind).toBeNull();

    cancelJob(ahead.jobId);
    cancelJob(behind.jobId);
  });
});
