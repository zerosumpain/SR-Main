import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_CALL_MS, PLANNER_TURN_MS } from './limits';
import { POLL_GIVE_UP_MS } from './job-client';
import { clearJobsForTest, JOB_CAP_MS, JOB_FAILED_MESSAGE, JOB_KEPT_MESSAGE, JOB_RETENTION_MS, JOB_TIMEOUT_MESSAGE, jobAccepted, jobResponse, readJob, startJob, wantsAsync } from './jobs.server';

// v6: async model-backed calls — in memory, caller-scoped, capped, retained 30 min.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T21:00:00Z'));
  clearJobsForTest();
});
afterEach(() => vi.useRealTimers());

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('trip jobs', () => {
  it('runs in the background: running → done with the synchronous result', async () => {
    let finish!: (v: unknown) => void;
    const job = startJob('Kid@Example.test', 'ideas', () => new Promise((r) => (finish = r)));
    expect(job).toEqual({ id: expect.any(String), kind: 'ideas', status: 'running', startedAt: '2026-10-14T21:00:00.000Z', finishedAt: null, result: null, error: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(readJob('kid@example.test', job.id)?.status).toBe('running');
    finish({ ideas: [{ title: 'Gelato' }] });
    await settle();
    expect(readJob('kid@example.test', job.id)).toMatchObject({ status: 'done', finishedAt: '2026-10-14T21:00:05.000Z', result: { ideas: [{ title: 'Gelato' }] }, error: null });
  });

  it('only the caller who started it may read it; anyone else (and an unknown id) gets 404', async () => {
    const job = startJob('kid@example.test', 'converse', async () => ({ reply: 'ok' }));
    await settle();
    expect(readJob('parent@example.test', job.id)).toBeNull();
    expect(jobResponse('parent@example.test', job.id).status).toBe(404);
    expect(jobResponse('kid@example.test', 'no-such-job').status).toBe(404);
    const ok = jobResponse('kid@example.test', job.id);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ job: { id: job.id, kind: 'converse', status: 'done', result: { reply: 'ok' } } });
  });

  it('fails a job past the cap with a plain message, and ignores a late answer', async () => {
    let finish!: (v: unknown) => void;
    const job = startJob('o@example.test', 'replan', () => new Promise((r) => (finish = r)));
    await vi.advanceTimersByTimeAsync(JOB_CAP_MS - 1);
    expect(readJob('o@example.test', job.id)?.status).toBe('running');
    await vi.advanceTimersByTimeAsync(1);
    expect(readJob('o@example.test', job.id)).toMatchObject({ status: 'failed', error: JOB_TIMEOUT_MESSAGE, result: null, finishedAt: new Date(Date.parse('2026-10-14T21:00:00Z') + JOB_CAP_MS).toISOString() });
    finish({ late: true });
    await settle();
    expect(readJob('o@example.test', job.id)?.status).toBe('failed');
  });

  it('a thrown error fails the job without leaking its text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const job = startJob('o@example.test', 'create', async () => {
      throw new Error('postgres: secret detail');
    });
    await settle();
    expect(readJob('o@example.test', job.id)).toMatchObject({ status: 'failed', error: JOB_FAILED_MESSAGE });
  });

  it('forgets a finished job 30 minutes after it finished, never a running one', async () => {
    const done = startJob('o@example.test', 'ideas', async () => ({}));
    const running = startJob('o@example.test', 'ideas', () => new Promise(() => {}), { capMs: 10 * JOB_RETENTION_MS });
    await settle();
    await vi.advanceTimersByTimeAsync(JOB_RETENTION_MS);
    expect(readJob('o@example.test', done.id)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(readJob('o@example.test', done.id)).toBeNull();
    expect(readJob('o@example.test', running.id)?.status).toBe('running');
  });

  it('opts in only with async: true, and answers 202 { job }', async () => {
    expect([wantsAsync({ async: true }), wantsAsync({ async: 'yes' }), wantsAsync({}), wantsAsync(null)]).toEqual([true, false, false, false]);
    const job = startJob('o@example.test', 'ideas', async () => ({}));
    const res = jobAccepted(job);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ job: { id: job.id, kind: 'ideas', status: 'running', startedAt: job.startedAt, finishedAt: null, result: null, error: null } });
  });

  it('the cap outlasts the longest turn: a planner turn plus its check never times out a job that would finish', () => {
    expect(JOB_CAP_MS).toBeGreaterThan(PLANNER_TURN_MS + CHECK_CALL_MS);
    // The site's poller waits past the cap, so the server's message wins.
    expect(POLL_GIVE_UP_MS).toBeGreaterThan(JOB_CAP_MS);
  });

  it('a turn that takes 4½ minutes (180 s turn + 90 s check) still finishes done', async () => {
    let finish!: (v: unknown) => void;
    const job = startJob('o@example.test', 'converse', () => new Promise((r) => (finish = r)));
    await vi.advanceTimersByTimeAsync(PLANNER_TURN_MS + CHECK_CALL_MS);
    finish({ reply: 'done' });
    await settle();
    expect(readJob('o@example.test', job.id)).toMatchObject({ status: 'done', result: { reply: 'done' } });
  });

  it('create: a trip made before the cap is never lost — the failed job still carries its id', async () => {
    const job = startJob('o@example.test', 'create', async (h) => {
      h.keep({ id: 'trip-1' });
      return new Promise(() => {});
    });
    await vi.advanceTimersByTimeAsync(JOB_CAP_MS);
    expect(readJob('o@example.test', job.id)).toMatchObject({ status: 'failed', result: { id: 'trip-1' }, error: JOB_KEPT_MESSAGE });
  });

  it('create: a throw after the trip row exists still carries its id; before it, nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = startJob('o@example.test', 'create', async (h) => {
      h.keep({ id: 'trip-2' });
      throw new Error('planner down');
    });
    const before = startJob('o@example.test', 'create', async () => {
      throw new Error('db down');
    });
    await settle();
    expect(readJob('o@example.test', after.id)).toMatchObject({ status: 'failed', result: { id: 'trip-2' }, error: JOB_KEPT_MESSAGE });
    expect(readJob('o@example.test', before.id)).toMatchObject({ status: 'failed', result: null, error: JOB_FAILED_MESSAGE });
  });
});
