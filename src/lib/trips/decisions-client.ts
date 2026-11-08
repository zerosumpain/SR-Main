// src/lib/trips/decisions-client.ts
//
// v8, the site page's calls for "propose, research, ask": one small JSON call
// that never throws (a dropped connection reads as an answer with an error),
// and the durable-job poller the guided start's progress card is driven by —
// every poll hands the job's stages to the page, and a cancelled or failed
// job ends the wait with the server's own words. Browser-safe; `fetch` and
// the wait are injectable for tests (decisions-client.test.ts).

import type { JobStage } from './decisions';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  body: T & { error?: string; message?: string };
}

type Fetch = typeof fetch;

/** One JSON call. Never throws: no answer is `{ ok: false, status: 0 }`. */
export async function api<T = Record<string, unknown>>(method: string, url: string, body?: unknown, f: Fetch = fetch): Promise<ApiResult<T>> {
  try {
    const res = await f(url, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    return { ok: res.ok, status: res.status, body: out };
  } catch {
    return { ok: false, status: 0, body: { error: 'The site did not answer. Try again.' } as T & { error?: string } };
  }
}

/** The words to show for a failed call. */
export function errorText(r: ApiResult<unknown>, fallback = 'That did not work. Try again.'): string {
  const b = r.body as { error?: unknown; message?: unknown };
  if (typeof b.error === 'string' && b.error) return b.error;
  if (typeof b.message === 'string' && b.message) return b.message;
  if (r.status === 404) return 'The site does not know how to do that yet.';
  if (r.status === 0) return 'The site did not answer. Try again.';
  return fallback;
}

/** A v8 durable job, as the poll returns it. */
export interface JobView {
  id: string;
  kind?: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  tripId?: string | null;
  stages?: JobStage[];
  result: unknown;
  error: string | null;
  startedAt?: string;
  finishedAt?: string | null;
}

export const JOB_POLL_MS = 1500;
/** The guided start can run for minutes (research is visible); stop watching after a quarter of an hour. */
export const JOB_WATCH_MS = 15 * 60_000;

/**
 * Watch a job until it finishes, handing every poll to `onUpdate`. Returns
 * the last job seen (status done / failed / cancelled), or a failed stand-in
 * when the job is lost or the watch gives up. `signal` stops watching (the
 * page closed) without cancelling the job — Cancel is a separate DELETE.
 */
export async function watchJob(
  jobId: string,
  opts: {
    onUpdate?: (job: JobView) => void;
    jobsBase?: string;
    fetch?: Fetch;
    wait?: (ms: number) => Promise<void>;
    signal?: { aborted: boolean };
    giveUpMs?: number;
  } = {},
): Promise<JobView> {
  const f = opts.fetch ?? fetch;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${opts.jobsBase ?? '/api/trips'}/jobs/${encodeURIComponent(jobId)}`;
  const giveUp = opts.giveUpMs ?? JOB_WATCH_MS;
  const lost = (error: string): JobView => ({ id: jobId, status: 'failed', result: null, error });
  let last: JobView | null = null;
  for (let waited = 0; waited < giveUp; waited += JOB_POLL_MS) {
    if (opts.signal?.aborted) return last ?? lost('Stopped watching.');
    const r = await f(url, { headers: { accept: 'application/json' } }).catch(() => null);
    if (r && r.status === 404) return lost('That got lost in an update — try again.');
    if (r && r.ok) {
      const { job } = (await r.json().catch(() => ({}))) as { job?: JobView };
      if (job) {
        last = job;
        opts.onUpdate?.(job);
        if (job.status !== 'running') return job;
      }
    }
    await wait(JOB_POLL_MS);
  }
  return last ? { ...last, status: 'failed', error: 'That is taking a long time. It may still finish — look in your trips in a while.' } : lost('That took too long — try again.');
}

/** Cancel a job: `DELETE …/jobs/:id` → `{ job }` (status cancelled once the work stops). */
export function cancelJob(jobId: string, jobsBase = '/api/trips', f: Fetch = fetch): Promise<ApiResult<{ job?: JobView }>> {
  return api<{ job?: JobView }>('DELETE', `${jobsBase}/jobs/${encodeURIComponent(jobId)}`, undefined, f);
}

/** The trip id a start job has made, as soon as it exists (`tripId`, else `result.id`). */
export function jobTripId(job: Pick<JobView, 'tripId' | 'result'>): string | null {
  if (typeof job.tripId === 'string' && job.tripId) return job.tripId;
  const r = job.result as { id?: unknown } | null;
  return r && typeof r.id === 'string' && r.id ? r.id : null;
}
