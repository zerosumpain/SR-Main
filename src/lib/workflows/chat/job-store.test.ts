import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  publishJobEvent,
  subscribeJob,
  createJob,
  getJob,
  cleanOldJobs,
  createWaiter,
  cancelJob,
  respondToWaiter,
  derivePhase,
  HEARTBEAT_MIN_SILENCE_MS,
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
      {
        type: 'heartbeat',
        phase: 'thinking',
        summary: 'Still working: fetching data',
        currentStep: 'fetching data',
        inflightTool: null,
        awaitingWaiter: null,
        elapsedMs: 30000,
        sinceLastEventMs: 30000,
        watchdog: { idleMs: 30000, idleLimitMs: 180000, totalMs: 30000, totalLimitMs: 600000 },
      } satisfies JobEvent,
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
      vi.advanceTimersByTime(HEARTBEAT_MIN_SILENCE_MS + 1_000);
      const hb = received.find((e) => e.type === 'heartbeat');
      expect(hb).toBeDefined();
      if (hb && hb.type === 'heartbeat') {
        expect(hb.phase).toBe('stalled');
        expect(hb.elapsedMs).toBeGreaterThanOrEqual(HEARTBEAT_MIN_SILENCE_MS);
        expect(hb.watchdog.idleLimitMs).toBe(180_000);
        expect(hb.watchdog.totalLimitMs).toBe(600_000);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not emit heartbeat while tokens are flowing', async () => {
    vi.useFakeTimers();
    try {
      const { jobId } = createJob('test');
      const received: JobEvent[] = [];
      subscribeJob(jobId, (e) => received.push(e));
      for (let i = 0; i < 5; i++) {
        publishJobEvent(jobId, { type: 'token', delta: 'x' });
        vi.advanceTimersByTime(10_000);
      }
      expect(received.filter((e) => e.type === 'heartbeat').length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits phase:tool heartbeat with sinceMs delta when a tool is in flight and silence has built up', () => {
    vi.useFakeTimers();
    try {
      const { jobId, job } = createJob('test');
      const received: JobEvent[] = [];
      subscribeJob(jobId, (e) => received.push(e));
      const start = Date.now();
      job.inflightTool = { name: 'stealth-scrape', toolCallId: 'c1', since: start };
      vi.advanceTimersByTime(HEARTBEAT_MIN_SILENCE_MS + 1_000);
      const hb = received.find((e) => e.type === 'heartbeat');
      expect(hb).toBeDefined();
      if (hb && hb.type === 'heartbeat') {
        expect(hb.phase).toBe('tool');
        expect(hb.inflightTool?.name).toBe('stealth-scrape');
        expect(hb.inflightTool?.sinceMs).toBeGreaterThanOrEqual(HEARTBEAT_MIN_SILENCE_MS);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits phase:awaiting_user heartbeat with sinceMs delta when a waiter is open', () => {
    vi.useFakeTimers();
    try {
      const { jobId, job } = createJob('test');
      const received: JobEvent[] = [];
      subscribeJob(jobId, (e) => received.push(e));
      const start = Date.now();
      job.awaitingWaiter = { kind: 'plan', key: 'plan:p1', since: start };
      vi.advanceTimersByTime(HEARTBEAT_MIN_SILENCE_MS + 1_000);
      const hb = received.find((e) => e.type === 'heartbeat');
      expect(hb).toBeDefined();
      if (hb && hb.type === 'heartbeat') {
        expect(hb.phase).toBe('awaiting_user');
        expect(hb.awaitingWaiter?.kind).toBe('plan');
        expect(hb.awaitingWaiter?.sinceMs).toBeGreaterThanOrEqual(HEARTBEAT_MIN_SILENCE_MS);
      }
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
      vi.advanceTimersByTime(HEARTBEAT_MIN_SILENCE_MS + 1_000);
      // Assert heartbeat actually fired — otherwise the lastEventAt check
      // below is vacuously true and we'd miss a broken heartbeat path.
      expect(received.some((e) => e.type === 'heartbeat')).toBe(true);
      expect(job.lastEventAt).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createJob initialises new heartbeat/plan fields', () => {
  it('sets inflightTool, awaitingWaiter, plan to null and counters to defaults', () => {
    const { jobId, job } = createJob('m');
    expect(job.inflightTool).toBeNull();
    expect(job.awaitingWaiter).toBeNull();
    expect(job.plan).toBeNull();
    expect(job.coveredStepIds).toBeInstanceOf(Set);
    expect(job.coveredStepIds.size).toBe(0);
    expect(job.selfProdCount).toBe(0);
    expect(job.lastSelfProdAt).toBeNull();
    expect(typeof jobId).toBe('string');
  });
});

describe('derivePhase', () => {
  afterEach(() => vi.useRealTimers());

  it('returns idle when job is not running', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.status = 'done';
    expect(derivePhase(job)).toBe('idle');
  });

  it('returns awaiting_user when a waiter is registered', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.awaitingWaiter = { kind: 'plan', key: 'plan:abc', since: Date.now() };
    expect(derivePhase(job)).toBe('awaiting_user');
  });

  it('returns tool when a tool is in flight', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.inflightTool = { name: 'stealth-scrape', toolCallId: 'c1', since: Date.now() };
    expect(derivePhase(job)).toBe('tool');
  });

  it('returns streaming when a recent token event arrived', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.lastTokenAt = Date.now();
    expect(derivePhase(job)).toBe('streaming');
  });

  it('returns streaming even when lastEventAt is stale, if lastTokenAt is recent', () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 0, 1);
    vi.setSystemTime(start);
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.lastEventAt = start - 30_000; // stale — would be stalled without lastTokenAt
    job.lastTokenAt = start;          // recent token
    expect(derivePhase(job)).toBe('streaming');
  });

  it('returns stalled when last event is older than 25s', () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 0, 1);
    vi.setSystemTime(start);
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    job.lastEventAt = start;
    vi.setSystemTime(start + HEARTBEAT_MIN_SILENCE_MS + 1_000);
    expect(derivePhase(job)).toBe('stalled');
  });

  it('returns thinking when running with no tool, no streaming, recent activity', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    expect(derivePhase(job)).toBe('thinking');
  });
});

describe('inflightTool tracking', () => {
  it('tool_start sets inflightTool, tool_result clears it', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    publishJobEvent(jobId, { type: 'tool_start', tool: 't1', args: {}, toolCallId: 'c1' });
    expect(job.inflightTool?.name).toBe('t1');
    expect(job.inflightTool?.toolCallId).toBe('c1');
    publishJobEvent(jobId, { type: 'tool_result', tool: 't1', result: {}, status: 'done', toolCallId: 'c1' });
    expect(job.inflightTool).toBeNull();
  });

  it('token event updates lastTokenAt', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    expect(job.lastTokenAt).toBeNull();
    publishJobEvent(jobId, { type: 'token', delta: 'hello' });
    expect(job.lastTokenAt).not.toBeNull();
  });
});

describe('awaitingWaiter tracking', () => {
  it('createWaiter sets awaitingWaiter, the returned respond callback clears it', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    const w = createWaiter<unknown>(jobId, 'plan:abc');
    expect(job.awaitingWaiter?.kind).toBe('plan');
    expect(job.awaitingWaiter?.key).toBe('plan:abc');
    w.respond('ok');
    expect(job.awaitingWaiter).toBeNull();
  });

  it('respondToWaiter (free function) also clears awaitingWaiter on key match', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    createWaiter<unknown>(jobId, 'clarify:q1');
    expect(job.awaitingWaiter?.kind).toBe('clarify');
    expect(respondToWaiter(jobId, 'clarify:q1', { answer: 'yes' })).toBe(true);
    expect(job.awaitingWaiter).toBeNull();
  });

  it('createWaiter with unknown prefix leaves awaitingWaiter null', () => {
    const { jobId } = createJob('hi');
    const job = getJob(jobId)!;
    createWaiter<unknown>(jobId, 'custom:xyz');
    expect(job.awaitingWaiter).toBeNull();
  });
});

describe('watchdog overrides self-prod', () => {
  it('watchdog still aborts a job whose lastEventAt is stale, regardless of selfProdCount', async () => {
    vi.useFakeTimers();
    try {
      const start = Date.UTC(2026, 0, 1);
      vi.setSystemTime(start);
      const { jobId } = createJob('hi');
      const job = getJob(jobId)!;
      job.selfProdCount = 1;          // mid-prodding
      job.lastEventAt = start;         // never moves

      vi.setSystemTime(start + 200_000); // > IDLE_TIMEOUT_MS (180s)
      await vi.advanceTimersByTimeAsync(15_000);
      expect(job.status).toBe('error');
      expect(job.error).toMatch(/idle/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
