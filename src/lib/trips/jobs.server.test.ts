import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_CALL_MS, PLANNER_TURN_MS } from './limits';
import { POLL_GIVE_UP_MS } from './job-client';
import {
  cancelJob,
  clearJobsForTest,
  JOB_CAP_MS,
  JOB_FAILED_MESSAGE,
  JOB_KEPT_MESSAGE,
  JOB_ORPHAN_MESSAGE,
  JOB_RETENTION_MS,
  JOB_TIMEOUT_MESSAGE,
  jobAccepted,
  jobCancelResponse,
  JobCancelled,
  jobPollResponse,
  jobResponse,
  KIND_CAP_MS,
  memoryJobStore,
  readJob,
  readJobDurable,
  setJobStore,
  startJob,
  wantsAsync,
  type JobHandle,
  type JobStore,
} from './jobs.server';

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
    expect(job).toEqual({ id: expect.any(String), kind: 'ideas', status: 'running', tripId: null, stages: [], startedAt: '2026-10-14T21:00:00.000Z', finishedAt: null, result: null, error: null });
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
    expect(await res.json()).toEqual({ job: { id: job.id, kind: 'ideas', status: 'running', tripId: null, stages: [], startedAt: job.startedAt, finishedAt: null, result: null, error: null } });
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

// v8: durable rows, stages, cancel. A memory store stands in for trip_job.
describe('durable, staged, cancellable jobs (v8)', () => {
  let rows: ReturnType<typeof memoryJobStore>;
  beforeEach(() => {
    rows = memoryJobStore();
    setJobStore(rows, { processStart: new Date('2026-10-14T20:00:00Z') });
  });
  afterEach(() => setJobStore(null));

  it('declares its stages, reports each, and writes every step to the store', async () => {
    let finish!: (v: unknown) => void;
    let h!: JobHandle;
    const job = startJob('o@example.test', 'pack', (handle) => {
      h = handle;
      return new Promise((r) => (finish = r));
    }, { tripId: 'trip-1', stages: [{ key: 'places', label: 'Finding places' }, { key: 'food', label: 'Finding places to eat' }] });
    expect(job).toMatchObject({ kind: 'pack', tripId: 'trip-1', stages: [{ key: 'places', label: 'Finding places', state: 'waiting', detail: null }, { key: 'food', state: 'waiting' }] });
    await settle();
    h.stage('places', 'running');
    h.stage('places', 'done', 'Found 38 places');
    h.stage('food', 'running');
    await settle();
    expect(readJob('o@example.test', job.id)?.stages).toEqual([
      { key: 'places', label: 'Finding places', state: 'done', detail: 'Found 38 places' },
      { key: 'food', label: 'Finding places to eat', state: 'running', detail: null },
    ]);
    expect(rows.rows.get(job.id)).toMatchObject({ ownerEmail: 'o@example.test', kind: 'pack', tripId: 'trip-1', status: 'running', stages: [{ state: 'done' }, { state: 'running' }] });
    finish({ ok: true });
    await settle();
    // A stage still running when the work ends is closed with it.
    expect(rows.rows.get(job.id)).toMatchObject({ status: 'done', result: { ok: true }, stages: [{ state: 'done' }, { state: 'done' }] });
  });

  it('a stage the job did not declare is added on the fly', async () => {
    const job = startJob('o@example.test', 'shapes', async (h) => {
      h.stage('extra', 'done', 'Something else');
      return {};
    });
    await settle();
    expect(readJob('o@example.test', job.id)?.stages).toEqual([{ key: 'extra', label: 'Something else', state: 'done', detail: 'Something else' }]);
  });

  it('a new trip job learns its trip as soon as the trip exists', async () => {
    const job = startJob('o@example.test', 'start', async (h) => {
      h.keep({ id: 'trip-9' });
      return new Promise(() => {});
    });
    await settle();
    expect(readJob('o@example.test', job.id)?.tripId).toBe('trip-9');
    expect(rows.rows.get(job.id)?.tripId).toBe('trip-9');
  });

  it('a poll after the process forgot the job reads the stored row (owner only), never a 404', async () => {
    const job = startJob('Kid@Example.test', 'ideas', async () => ({ ideas: ['gelato'] }));
    await settle();
    clearJobsForTest();
    expect(readJob('kid@example.test', job.id)).toBeNull();
    expect(await readJobDurable('kid@example.test', job.id)).toMatchObject({ id: job.id, status: 'done', result: { ideas: ['gelato'] } });
    expect(await readJobDurable('parent@example.test', job.id)).toBeNull();
    expect((await jobPollResponse('parent@example.test', job.id)).status).toBe(404);
    const res = await jobPollResponse('kid@example.test', job.id);
    expect(res.status).toBe(200);
    expect((await res.json()).job).toMatchObject({ status: 'done' });
    expect((await jobPollResponse('kid@example.test', 'not-a-uuid')).status).toBe(404);
  });

  it('a job a previous process left running reads as failed with the restart message, keeping a made trip', async () => {
    rows.rows.set('0b8a2c1e-0000-4000-8000-000000000001', {
      id: '0b8a2c1e-0000-4000-8000-000000000001', tripId: 'trip-3', ownerEmail: 'o@example.test', kind: 'start', status: 'running',
      stages: [{ key: 'brief', label: 'Setting up the trip', state: 'done', detail: null }, { key: 'places', label: 'Finding places', state: 'running', detail: null }],
      result: { id: 'trip-3' }, error: null, cancelRequested: false, startedAt: '2026-10-14T19:00:00.000Z', updatedAt: '2026-10-14T19:01:00.000Z', finishedAt: null,
    });
    const job = await readJobDurable('o@example.test', '0b8a2c1e-0000-4000-8000-000000000001');
    expect(job).toMatchObject({ status: 'failed', error: JOB_ORPHAN_MESSAGE, result: { id: 'trip-3' }, stages: [{ state: 'done' }, { state: 'failed' }] });
    // …and the sweep has written that down.
    expect(rows.rows.get('0b8a2c1e-0000-4000-8000-000000000001')).toMatchObject({ status: 'failed', error: JOB_ORPHAN_MESSAGE });
  });

  it('cancel: the work hears it between stages and the job reads cancelled, keeping what was made', async () => {
    let reached = '';
    let go!: () => void;
    const gate = new Promise<void>((r) => (go = r));
    const job = startJob('o@example.test', 'start', async (h) => {
      h.keep({ id: 'trip-5' });
      h.stage('brief', 'done');
      h.stage('places', 'running');
      await gate;
      if (await h.cancelled()) throw new JobCancelled();
      reached = 'shapes';
      return { id: 'trip-5' };
    }, { stages: [{ key: 'brief', label: 'Setting up the trip' }, { key: 'places', label: 'Finding places' }, { key: 'shapes', label: 'Drafting ways to do it' }] });
    await settle();
    const res = await jobCancelResponse('o@example.test', job.id);
    expect(res.status).toBe(200);
    expect((await res.json()).job).toMatchObject({ id: job.id, status: 'running' });
    expect(await rows.cancelRequested(job.id)).toBe(true);
    go();
    await settle();
    expect(reached).toBe('');
    expect(readJob('o@example.test', job.id)).toMatchObject({ status: 'cancelled', result: { id: 'trip-5' }, error: null, stages: [{ state: 'done' }, { state: 'skipped' }, { state: 'skipped' }] });
    expect(rows.rows.get(job.id)?.status).toBe('cancelled');
  });

  it('cancel: work that never asks still finishes, and reads cancelled rather than done', async () => {
    let finish!: (v: unknown) => void;
    const job = startJob('o@example.test', 'converse', () => new Promise((r) => (finish = r)));
    expect(await cancelJob('o@example.test', job.id)).toMatchObject({ status: 'running' });
    finish({ reply: 'late' });
    await settle();
    expect(readJob('o@example.test', job.id)?.status).toBe('cancelled');
  });

  it('cancel: only the caller who started it; an unknown id is a 404', async () => {
    const job = startJob('o@example.test', 'pack', () => new Promise(() => {}));
    expect(await cancelJob('kid@example.test', job.id)).toBeNull();
    expect((await jobCancelResponse('o@example.test', '0b8a2c1e-0000-4000-8000-00000000ffff')).status).toBe(404);
    expect(readJob('o@example.test', job.id)?.status).toBe('running');
  });

  it('cancelled() also hears a cancel asked through the store (another process)', async () => {
    let h!: JobHandle;
    const job = startJob('o@example.test', 'pack', (handle) => {
      h = handle;
      return new Promise(() => {});
    });
    await settle();
    expect(await h.cancelled()).toBe(false);
    await rows.requestCancel(job.id, 'o@example.test');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(await h.cancelled()).toBe(true);
  });

  it('a database error never fails the job', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken: JobStore = {
      insert: async () => { throw new Error('db down'); },
      update: async () => { throw new Error('db down'); },
      get: async () => { throw new Error('db down'); },
      requestCancel: async () => { throw new Error('db down'); },
      cancelRequested: async () => { throw new Error('db down'); },
      failOrphans: async () => { throw new Error('db down'); },
    };
    setJobStore(broken);
    const job = startJob('o@example.test', 'pack', async (h) => {
      h.stage('places', 'done', 'Found 3 places');
      expect(await h.cancelled()).toBe(false);
      return { ok: 1 };
    });
    await settle();
    expect(readJob('o@example.test', job.id)).toMatchObject({ status: 'done', result: { ok: 1 } });
    expect(await readJobDurable('o@example.test', '0b8a2c1e-0000-4000-8000-000000000002')).toBeNull();
  });

  it('the research pack and the guided start have caps of their own, longer than a turn', async () => {
    expect(KIND_CAP_MS.pack).toBeGreaterThan(JOB_CAP_MS);
    expect(KIND_CAP_MS.start).toBeGreaterThan(KIND_CAP_MS.pack!);
    const job = startJob('o@example.test', 'pack', () => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(JOB_CAP_MS + 1);
    expect(readJob('o@example.test', job.id)?.status).toBe('running');
    await vi.advanceTimersByTimeAsync(KIND_CAP_MS.pack!);
    expect(readJob('o@example.test', job.id)).toMatchObject({ status: 'failed', error: JOB_TIMEOUT_MESSAGE });
  });
});
