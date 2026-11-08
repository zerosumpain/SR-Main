// src/lib/trips/job-client.ts
//
// v6, the site page's half of async model-backed calls: POST with
// `"async": true`, then poll GET /api/trips/jobs/:jobId until the job is done
// or failed. A server that answers synchronously (any non-202) is taken as
// the answer, so the page works either way. Browser-safe; `fetch` and the
// wait are injectable for tests.

import { TURN_CEILING_MS } from './limits';

export interface JobOutcome<T> {
  ok: boolean;
  /** The synchronous call's JSON (or the job's `result`), or `{ error }`. */
  body: T & { error?: string };
}

interface PolledJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  result: unknown;
  error: string | null;
}

export const POLL_EVERY_MS = 1500;
/**
 * A little past the server's job cap (the turn's ceiling + 30 s, see
 * ./jobs.server), so the server's own message wins.
 */
export const POLL_GIVE_UP_MS = TURN_CEILING_MS + 45_000;

export async function postAsJob<T>(
  url: string,
  body: Record<string, unknown>,
  deps: { fetch?: typeof fetch; wait?: (ms: number) => Promise<void>; jobsBase?: string; giveUpMs?: number } = {},
): Promise<JobOutcome<T>> {
  const f = deps.fetch ?? fetch;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, async: true }) });
  const first = (await res.json().catch(() => ({}))) as { job?: PolledJob } & Record<string, unknown>;
  if (res.status !== 202 || !first.job) return { ok: res.ok, body: first as T & { error?: string } };
  const poll = `${deps.jobsBase ?? '/api/trips'}/jobs/${encodeURIComponent(first.job.id)}`;
  const giveUp = deps.giveUpMs ?? POLL_GIVE_UP_MS;
  for (let waited = 0; waited < giveUp; waited += POLL_EVERY_MS) {
    await wait(POLL_EVERY_MS);
    const r = await f(poll).catch(() => null);
    if (!r) continue; // a blip: keep polling
    if (r.status === 404) return { ok: false, body: { error: 'That got lost in an update — try again.' } as T & { error?: string } };
    if (!r.ok) continue;
    const { job } = (await r.json().catch(() => ({}))) as { job?: PolledJob };
    if (!job || job.status === 'running') continue;
    if (job.status === 'done') return { ok: true, body: (job.result ?? {}) as T & { error?: string } };
    return { ok: false, body: { error: job.error ?? 'Something went wrong — try again.' } as T & { error?: string } };
  }
  return { ok: false, body: { error: 'That took too long — try again.' } as T & { error?: string } };
}
