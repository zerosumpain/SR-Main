// src/lib/trips/jobs.server.ts
//
// v6: async model-backed calls. A planner turn (ideas, a conversation turn,
// creating a trip, a whole-trip re-plan) can take longer than the phone's
// 30 s request timeout, and Cloudflare cuts a proxied request at ~100 s. With
// `"async": true` the route answers at once `202 { job }` and the work runs
// here in the background; the caller polls `GET …/trips/jobs/:jobId`.
//
// In memory, per process: a job is readable only by the caller who started
// it (anyone else gets 404, as for an unknown id), is failed with a plain
// message once it outruns the longest the work itself can take (JOB_CAP_MS,
// derived from the planner's own ceilings in ./limits), and is forgotten
// 30 min after it finishes. An id lost to a restart is a 404 too: the app
// says "try again".

import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { TURN_CEILING_MS } from './limits';

export type TripJobKind = 'ideas' | 'converse' | 'create' | 'replan';
export type TripJobStatus = 'running' | 'done' | 'failed';

/** The job as the caller sees it (`{ job }` on 202 and on every poll). */
export interface TripJob {
  id: string;
  kind: TripJobKind;
  status: TripJobStatus;
  startedAt: string;
  finishedAt: string | null;
  /** The same JSON the synchronous call returns, once done. */
  result: unknown;
  error: string | null;
}

/**
 * A little past the longest a turn can run (its own model-call ceilings plus
 * re-solves), so the cap only catches work that is truly stuck — never work
 * that would have finished and saved anyway.
 */
export const JOB_CAP_MS = TURN_CEILING_MS + 30_000;
export const JOB_RETENTION_MS = 30 * 60_000;
/** A ceiling on what one process holds, oldest finished first out. */
const MAX_JOBS = 500;

export const JOB_TIMEOUT_MESSAGE = 'That took too long — try again.';
export const JOB_FAILED_MESSAGE = 'Something went wrong — try again.';
/** A trip was created but its first turn did not finish: it is saved, not lost. */
export const JOB_KEPT_MESSAGE = 'Your trip is saved, but the planner did not finish — open it from your trips and carry on.';

/**
 * Handed to the work: `keep` records a partial result (a created trip's
 * `{ id }`) that a failed or capped job still carries, so what was already
 * made is never lost with the error.
 */
export interface JobHandle {
  keep(partial: Record<string, unknown>): void;
}

interface Entry {
  job: TripJob;
  /** Lower-cased email of whoever started it. */
  owner: string;
  finishedMs: number | null;
}

const jobs = new Map<string, Entry>();

const norm = (email: string) => email.trim().toLowerCase();

function prune(now: number): void {
  for (const [id, e] of jobs) if (e.finishedMs !== null && now - e.finishedMs > JOB_RETENTION_MS) jobs.delete(id);
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs].filter(([, e]) => e.finishedMs !== null).sort((a, b) => a[1].finishedMs! - b[1].finishedMs!);
  for (const [id] of finished.slice(0, jobs.size - MAX_JOBS)) jobs.delete(id);
}

const view = (job: TripJob): TripJob => ({ ...job });

/**
 * Start `work` in the background for `owner`. Returns the running job at
 * once. `work` returns the synchronous call's JSON body; a throw (or the
 * cap) fails the job with a plain message — never the error text itself. A
 * failed job's `result` is whatever the work `keep`-ed (else null).
 */
export function startJob(owner: string, kind: TripJobKind, work: (handle: JobHandle) => Promise<unknown>, opts: { capMs?: number; now?: () => number } = {}): TripJob {
  const now = opts.now ?? Date.now;
  prune(now());
  const job: TripJob = { id: randomUUID(), kind, status: 'running', startedAt: new Date(now()).toISOString(), finishedAt: null, result: null, error: null };
  const entry: Entry = { job, owner: norm(owner), finishedMs: null };
  jobs.set(job.id, entry);
  const finish = (patch: Pick<TripJob, 'status' | 'result' | 'error'>) => {
    if (entry.job.status !== 'running') return;
    const t = now();
    entry.job = { ...entry.job, ...patch, finishedAt: new Date(t).toISOString() };
    entry.finishedMs = t;
  };
  let kept: Record<string, unknown> | null = null;
  const handle: JobHandle = {
    keep: (partial) => {
      kept = { ...(kept ?? {}), ...partial };
    },
  };
  const failed = (error: string) => finish({ status: 'failed', result: kept, error: kept ? JOB_KEPT_MESSAGE : error });
  const cap = setTimeout(() => {
    console.warn(`[trips/jobs] ${kind} ${job.id} hit the ${Math.round((opts.capMs ?? JOB_CAP_MS) / 1000)} s cap`);
    failed(JOB_TIMEOUT_MESSAGE);
  }, opts.capMs ?? JOB_CAP_MS);
  // Unref so a pending cap never holds the process open.
  (cap as { unref?: () => void }).unref?.();
  void Promise.resolve()
    .then(() => work(handle))
    .then(
      (result) => finish({ status: 'done', result: result ?? null, error: null }),
      (err) => {
        console.error(`[trips/jobs] ${kind} ${job.id} failed:`, err);
        failed(JOB_FAILED_MESSAGE);
      },
    )
    .finally(() => clearTimeout(cap));
  return view(job);
}

/** The job, when `owner` started it and it is still held; null otherwise (→ 404). */
export function readJob(owner: string, id: string, now: () => number = Date.now): TripJob | null {
  prune(now());
  const e = jobs.get(id);
  if (!e || e.owner !== norm(owner)) return null;
  return view(e.job);
}

/** `202 { job }`: the answer to a call made with `"async": true`. */
export function jobAccepted(job: TripJob): Response {
  return json({ job }, { status: 202 });
}

/** `200 { job }` or `404` for a poll. */
export function jobResponse(owner: string, id: string): Response {
  const job = readJob(owner, id);
  if (!job) return json({ error: 'That got lost in an update — try again.' }, { status: 404 });
  return json({ job }, { headers: { 'cache-control': 'private, no-store' } });
}

/** True when a request body opts in to the async path. */
export const wantsAsync = (body: unknown): boolean => !!body && typeof body === 'object' && (body as { async?: unknown }).async === true;

/** Tests only: forget every job. */
export function clearJobsForTest(): void {
  jobs.clear();
}
