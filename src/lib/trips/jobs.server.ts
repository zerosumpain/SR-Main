// src/lib/trips/jobs.server.ts
//
// v6: async model-backed calls. A planner turn (ideas, a conversation turn,
// creating a trip, a whole-trip re-plan) can take longer than the phone's
// 30 s request timeout, and Cloudflare cuts a proxied request at ~100 s. With
// `"async": true` the route answers at once `202 { job }` and the work runs
// here in the background; the caller polls `GET …/trips/jobs/:jobId`.
//
// A job is readable only by the caller who started it (anyone else gets 404,
// as for an unknown id), is failed with a plain message once it outruns the
// longest the work itself can take (JOB_CAP_MS, derived from the planner's
// own ceilings in ./limits, or the kind's own cap), and is forgotten from
// memory 30 min after it finishes.
//
// v8 (2026-10-21): durable, staged and cancellable. Every job is also
// written to `trip_job` through a pluggable store (./decisions.store.server
// in the app; a memory store under the test runner, so a unit test never
// reaches Postgres). The in-memory map stays the cache for this process; a
// poll for an id it no longer holds reads the row, so a restart never turns
// a poll into a 404 — a job left running by a previous process reads as
// failed ("The server restarted before that finished — try again."). A
// database error never fails the job: it is logged and the work carries on.
//
// Long work declares its STAGES ("Finding places", "Checking opening hours
// on your dates") and reports each through `handle.stage`, so the phone shows
// what is happening instead of a seconds counter; `handle.cancelled()` is how
// the work hears a DELETE, between its stages. Work that never asks (a
// conversation turn) still finishes; its result is then reported as
// cancelled rather than done.

import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import type { JobStage, JobStageState } from './decisions';
import type { JobRow } from './decisions.store.server';
import { TURN_CEILING_MS } from './limits';

export type TripJobKind = 'ideas' | 'converse' | 'create' | 'replan' | 'pack' | 'shapes' | 'start' | 'proposals';
export type TripJobStatus = 'running' | 'done' | 'failed' | 'cancelled';

/** The job as the caller sees it (`{ job }` on 202 and on every poll). */
export interface TripJob {
  id: string;
  kind: TripJobKind;
  status: TripJobStatus;
  /** v8: the trip it works on, when there is one (a new trip's once it exists). */
  tripId: string | null;
  /** v8: its progress, one line per stage; [] for work that declares none. */
  stages: JobStage[];
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
/**
 * v8: the research pack (two map queries, Wikidata, up to six searches and
 * three model calls) and the guided start (the pack, then shapes and
 * questions) run longer than one turn.
 */
export const KIND_CAP_MS: Partial<Record<TripJobKind, number>> = {
  pack: 12 * 60_000,
  start: 18 * 60_000,
  shapes: 6 * 60_000,
};
export const JOB_RETENTION_MS = 30 * 60_000;
/** A ceiling on what one process holds, oldest finished first out. */
const MAX_JOBS = 500;
/** How often `cancelled()` asks the store (another process may have asked). */
const CANCEL_POLL_MS = 2_000;

export const JOB_TIMEOUT_MESSAGE = 'That took too long — try again.';
export const JOB_FAILED_MESSAGE = 'Something went wrong — try again.';
/** A trip was created but its first turn did not finish: it is saved, not lost. */
export const JOB_KEPT_MESSAGE = 'Your trip is saved, but the planner did not finish — open it from your trips and carry on.';
/** v8: a job a previous process was running when it stopped. */
export const JOB_ORPHAN_MESSAGE = 'The server restarted before that finished — try again.';

/** v8: a stage the job declares up front, shown as 'waiting' until it starts. */
export interface StageDecl {
  key: string;
  label: string;
}

/**
 * Handed to the work: `keep` records a partial result (a created trip's
 * `{ id }`) that a failed or capped job still carries, so what was already
 * made is never lost with the error. v8: `stage` reports progress;
 * `cancelled` says whether the caller asked it to stop (or the cap was hit).
 */
export interface JobHandle {
  keep(partial: Record<string, unknown>): void;
  stage(key: string, state: JobStageState, detail?: string | null): void;
  cancelled(): Promise<boolean>;
}

/** Thrown by work that stops because it was cancelled; the job reads `cancelled`. */
export class JobCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

// ── The store (durable rows) ───────────────────────────────────────────────

export type JobPatch = Partial<Pick<JobRow, 'tripId' | 'status' | 'stages' | 'result' | 'error' | 'finishedAt'>>;

export interface JobStore {
  insert(j: { id: string; tripId: string | null; ownerEmail: string; kind: string; stages: JobStage[] }): Promise<void>;
  update(id: string, patch: JobPatch): Promise<void>;
  get(id: string): Promise<JobRow | null>;
  requestCancel(id: string, ownerEmail: string): Promise<boolean>;
  cancelRequested(id: string): Promise<boolean>;
  failOrphans(before: Date, message: string): Promise<number>;
}

/** `trip_job` through ./decisions.store.server (imported on first use). */
const dbJobStore: JobStore = {
  insert: async (j) => (await import('./decisions.store.server')).insertJob(j),
  update: async (id, patch) => (await import('./decisions.store.server')).updateJob(id, patch),
  get: async (id) => (await import('./decisions.store.server')).getJob(id),
  requestCancel: async (id, owner) => (await import('./decisions.store.server')).requestCancel(id, owner),
  cancelRequested: async (id) => (await import('./decisions.store.server')).cancelRequested(id),
  failOrphans: async (before, message) => (await import('./decisions.store.server')).failOrphanJobs(before, message),
};

/** A store in memory: the test runner's default, and what tests inject to look inside. */
export function memoryJobStore(): JobStore & { rows: Map<string, JobRow & { cancelRequested: boolean }> } {
  const rows = new Map<string, JobRow & { cancelRequested: boolean }>();
  return {
    rows,
    async insert(j) {
      const at = new Date().toISOString();
      rows.set(j.id, { ...j, ownerEmail: norm(j.ownerEmail), status: 'running', result: null, error: null, cancelRequested: false, startedAt: at, updatedAt: at, finishedAt: null });
    },
    async update(id, patch) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, ...patch, updatedAt: new Date().toISOString() });
    },
    async get(id) {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async requestCancel(id, owner) {
      const r = rows.get(id);
      if (!r || r.ownerEmail !== norm(owner) || r.status !== 'running') return false;
      r.cancelRequested = true;
      return true;
    },
    async cancelRequested(id) {
      return rows.get(id)?.cancelRequested === true;
    },
    async failOrphans(before, message) {
      let n = 0;
      for (const r of rows.values()) {
        if (r.status === 'running' && Date.parse(r.startedAt) < before.getTime()) {
          Object.assign(r, { status: 'failed', error: message, finishedAt: new Date().toISOString() });
          n++;
        }
      }
      return n;
    },
  };
}

let injected: JobStore | null = null;
let testDefault: JobStore | null = null;

/**
 * The store in use. Under the test runner the default is a memory store: a
 * unit test that starts a job must never reach a database, and most of them
 * never think about the store at all.
 */
function store(): JobStore {
  if (injected) return injected;
  if (process.env.VITEST) return (testDefault ??= memoryJobStore());
  return dbJobStore;
}

/** When this process started: a running row older than this belongs to a previous one. */
let PROCESS_START = new Date();

/** Tests (and nothing else): use this store (and this process start); null restores the default. */
export function setJobStore(s: JobStore | null, opts: { processStart?: Date } = {}): void {
  injected = s;
  orphansSwept = null;
  if (opts.processStart) PROCESS_START = opts.processStart;
}
let orphansSwept: Promise<void> | null = null;

/** Once per process: rows a previous process left running are failed with a plain message. */
function sweepOrphans(): Promise<void> {
  orphansSwept ??= store()
    .failOrphans(PROCESS_START, JOB_ORPHAN_MESSAGE)
    .then((n) => {
      if (n) console.warn(`[trips/jobs] ${n} job(s) left running by a previous process marked failed`);
    })
    .catch((err) => console.warn('[trips/jobs] orphan sweep failed:', (err as Error)?.message));
  return orphansSwept;
}

// ── The process's cache ────────────────────────────────────────────────────

interface Entry {
  job: TripJob;
  /** Lower-cased email of whoever started it. */
  owner: string;
  finishedMs: number | null;
  cancel: boolean;
  /** Writes to the store, in order (the insert first). */
  persist: Promise<void>;
}

const jobs = new Map<string, Entry>();

const norm = (email: string) => email.trim().toLowerCase();

function prune(now: number): void {
  for (const [id, e] of jobs) if (e.finishedMs !== null && now - e.finishedMs > JOB_RETENTION_MS) jobs.delete(id);
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs].filter(([, e]) => e.finishedMs !== null).sort((a, b) => a[1].finishedMs! - b[1].finishedMs!);
  for (const [id] of finished.slice(0, jobs.size - MAX_JOBS)) jobs.delete(id);
}

const view = (job: TripJob): TripJob => ({ ...job, stages: job.stages.map((s) => ({ ...s })) });

/** Queue a write; a failure is logged, never thrown into the work. */
function persist(entry: Entry, write: (s: JobStore) => Promise<unknown>): void {
  entry.persist = entry.persist
    .then(() => write(store()))
    .then(
      () => undefined,
      (err) => console.warn(`[trips/jobs] could not save ${entry.job.kind} ${entry.job.id}:`, (err as Error)?.message),
    );
}

/** Stages left open when a job ends: a running one takes the ending's state, waiting ones are skipped. */
function closeStages(stages: JobStage[], running: JobStageState): JobStage[] {
  return stages.map((s) => (s.state === 'running' ? { ...s, state: running } : s.state === 'waiting' ? { ...s, state: 'skipped' } : s));
}

export interface StartJobOptions {
  capMs?: number;
  now?: () => number;
  /** v8: the trip the job works on (null for a trip not yet made). */
  tripId?: string | null;
  /** v8: the stages it will report, in order; each starts 'waiting'. */
  stages?: StageDecl[];
}

/**
 * Start `work` in the background for `owner`. Returns the running job at
 * once. `work` returns the synchronous call's JSON body; a throw (or the
 * cap) fails the job with a plain message — never the error text itself. A
 * failed job's `result` is whatever the work `keep`-ed (else null).
 */
export function startJob(owner: string, kind: TripJobKind, work: (handle: JobHandle) => Promise<unknown>, opts: StartJobOptions = {}): TripJob {
  const now = opts.now ?? Date.now;
  prune(now());
  void sweepOrphans();
  const job: TripJob = {
    id: randomUUID(),
    kind,
    status: 'running',
    tripId: opts.tripId ?? null,
    stages: (opts.stages ?? []).map((s) => ({ key: s.key, label: s.label, state: 'waiting' as const, detail: null })),
    startedAt: new Date(now()).toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  const entry: Entry = { job, owner: norm(owner), finishedMs: null, cancel: false, persist: Promise.resolve() };
  jobs.set(job.id, entry);
  persist(entry, (s) => s.insert({ id: job.id, tripId: job.tripId, ownerEmail: entry.owner, kind, stages: job.stages }));

  const finish = (patch: Pick<TripJob, 'status' | 'result' | 'error'>) => {
    if (entry.job.status !== 'running') return;
    const t = now();
    const stages = closeStages(entry.job.stages, patch.status === 'done' ? 'done' : patch.status === 'cancelled' ? 'skipped' : 'failed');
    entry.job = { ...entry.job, ...patch, stages, finishedAt: new Date(t).toISOString() };
    entry.finishedMs = t;
    const { status, result, error, finishedAt } = entry.job;
    persist(entry, (s) => s.update(job.id, { status, result, error, finishedAt, stages }));
  };
  let kept: Record<string, unknown> | null = null;
  let lastAsked = 0;
  const handle: JobHandle = {
    keep: (partial) => {
      kept = { ...(kept ?? {}), ...partial };
      // A new trip's job learns its trip as soon as the trip exists.
      if (entry.job.tripId === null && typeof partial.id === 'string' && (kind === 'start' || kind === 'create')) {
        entry.job = { ...entry.job, tripId: partial.id };
        persist(entry, (s) => s.update(job.id, { tripId: partial.id as string }));
      }
    },
    stage: (key, state, detail) => {
      if (entry.job.status !== 'running') return;
      const i = entry.job.stages.findIndex((s) => s.key === key);
      const next: JobStage = { key, label: i >= 0 ? entry.job.stages[i].label : (detail ?? key), state, detail: detail ?? (i >= 0 ? entry.job.stages[i].detail : null) };
      const stages = i >= 0 ? entry.job.stages.map((s, j) => (j === i ? next : s)) : [...entry.job.stages, next];
      entry.job = { ...entry.job, stages };
      persist(entry, (s) => s.update(job.id, { stages }));
    },
    cancelled: async () => {
      if (entry.cancel || entry.job.status !== 'running') return true;
      const t = now();
      if (t - lastAsked < CANCEL_POLL_MS) return false;
      lastAsked = t;
      try {
        if (await store().cancelRequested(job.id)) entry.cancel = true;
      } catch {
        /* the store is down: carry on */
      }
      return entry.cancel;
    },
  };
  const failed = (error: string) => finish({ status: 'failed', result: kept, error: kept ? JOB_KEPT_MESSAGE : error });
  const capMs = opts.capMs ?? KIND_CAP_MS[kind] ?? JOB_CAP_MS;
  const cap = setTimeout(() => {
    console.warn(`[trips/jobs] ${kind} ${job.id} hit the ${Math.round(capMs / 1000)} s cap`);
    failed(JOB_TIMEOUT_MESSAGE);
  }, capMs);
  // Unref so a pending cap never holds the process open.
  (cap as { unref?: () => void }).unref?.();
  void Promise.resolve()
    .then(() => work(handle))
    .then(
      (result) => (entry.cancel ? finish({ status: 'cancelled', result: kept, error: null }) : finish({ status: 'done', result: result ?? null, error: null })),
      (err) => {
        if (entry.cancel || err instanceof JobCancelled) return finish({ status: 'cancelled', result: kept, error: null });
        console.error(`[trips/jobs] ${kind} ${job.id} failed:`, err);
        failed(JOB_FAILED_MESSAGE);
      },
    )
    .finally(() => clearTimeout(cap));
  return view(job);
}

/** The job, when `owner` started it and this process still holds it; null otherwise (→ 404). */
export function readJob(owner: string, id: string, now: () => number = Date.now): TripJob | null {
  prune(now());
  const e = jobs.get(id);
  if (!e || e.owner !== norm(owner)) return null;
  return view(e.job);
}

/** A stored row as the caller sees it; a row a previous process left running reads as failed. */
function fromRow(r: JobRow): TripJob {
  const orphan = r.status === 'running' && Date.parse(r.startedAt) < PROCESS_START.getTime();
  const status: TripJobStatus = orphan ? 'failed' : r.status;
  // A finished row (the orphan sweep writes only the status) never shows a stage still running.
  const stages = status === 'running' ? (r.stages ?? []) : closeStages(r.stages ?? [], status === 'done' ? 'done' : status === 'cancelled' ? 'skipped' : 'failed');
  return {
    id: r.id,
    kind: r.kind as TripJobKind,
    status,
    tripId: r.tripId,
    stages,
    startedAt: r.startedAt,
    finishedAt: orphan ? (r.finishedAt ?? r.updatedAt) : r.finishedAt,
    // A new trip made before the restart is still handed back.
    result: r.result ?? null,
    error: orphan ? JOB_ORPHAN_MESSAGE : r.error,
  };
}

/**
 * v8: the job from this process, else from its stored row (owner checked) —
 * so a poll after a restart, or 30 minutes on, still answers.
 */
export async function readJobDurable(owner: string, id: string): Promise<TripJob | null> {
  const held = readJob(owner, id);
  if (held) return held;
  if (jobs.has(id)) return null; // held, but someone else's
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await sweepOrphans();
  try {
    const row = await store().get(id);
    if (!row || norm(row.ownerEmail) !== norm(owner)) return null;
    return fromRow(row);
  } catch (err) {
    console.warn('[trips/jobs] could not read a stored job:', (err as Error)?.message);
    return null;
  }
}

/**
 * v8: ask a job to stop. The work hears it between stages (`cancelled()`)
 * and the job reads `cancelled` once it stops; null when there is no such job
 * of this caller's (→ 404). A finished job is returned as it is.
 */
export async function cancelJob(owner: string, id: string): Promise<TripJob | null> {
  const e = jobs.get(id);
  if (e) {
    if (e.owner !== norm(owner)) return null;
    if (e.job.status === 'running' && !e.cancel) {
      e.cancel = true;
      persist(e, (s) => s.requestCancel(id, e.owner));
    }
    return view(e.job);
  }
  const found = await readJobDurable(owner, id);
  if (found?.status === 'running') {
    await store()
      .requestCancel(id, owner)
      .catch((err) => console.warn('[trips/jobs] could not ask a stored job to stop:', (err as Error)?.message));
  }
  return found;
}

/** `202 { job }`: the answer to a call made with `"async": true`. */
export function jobAccepted(job: TripJob): Response {
  return json({ job }, { status: 202 });
}

const LOST = 'That got lost in an update — try again.';

/** `200 { job }` or `404` for a poll — this process's jobs only. */
export function jobResponse(owner: string, id: string): Response {
  const job = readJob(owner, id);
  if (!job) return json({ error: LOST }, { status: 404 });
  return json({ job }, { headers: { 'cache-control': 'private, no-store' } });
}

/** v8: the poll the routes answer — this process's job, else its stored row. */
export async function jobPollResponse(owner: string, id: string): Promise<Response> {
  const job = await readJobDurable(owner, id);
  if (!job) return json({ error: LOST }, { status: 404 });
  return json({ job }, { headers: { 'cache-control': 'private, no-store' } });
}

/** v8: `DELETE …/jobs/:jobId` — `200 { job }` or 404. */
export async function jobCancelResponse(owner: string, id: string): Promise<Response> {
  const job = await cancelJob(owner, id);
  if (!job) return json({ error: LOST }, { status: 404 });
  return json({ job }, { headers: { 'cache-control': 'private, no-store' } });
}

/** True when a request body opts in to the async path. */
export const wantsAsync = (body: unknown): boolean => !!body && typeof body === 'object' && (body as { async?: unknown }).async === true;

/** Tests only: forget every job. */
export function clearJobsForTest(): void {
  jobs.clear();
}
