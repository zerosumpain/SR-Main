// The worker pool (spec §11.1). The worker is bundled once with esbuild into
// a temporary module and run by plain Node, the way production runs the
// engine (a test runner's module shim or a per-file loader is markedly
// slower). Jobs are grouped by params variant; a worker serves one variant
// for its whole life, so a slot switching variants gets a fresh worker.
// With `workers: 0` jobs run in this thread (tests, and runs without esbuild).

import { mkdtempSync, rmSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { runJob, type Job, type JobResult } from './jobs';

const HERE = dirname(fileURLToPath(import.meta.url));

let bundled: { dir: string; file: string } | null = null;

/** Bundles worker.ts (cached per process); null when esbuild is not installed. */
async function workerBundle(): Promise<string | null> {
  if (bundled) return bundled.file;
  let esbuild: typeof import('esbuild');
  try {
    esbuild = await import('esbuild');
  } catch {
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), 'hometowns-lab-'));
  const file = join(dir, 'lab-worker.mjs');
  await esbuild.build({ entryPoints: [join(HERE, 'worker.ts')], bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'silent' });
  bundled = { dir, file };
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  return file;
}

export interface PoolOptions {
  /** Worker threads (default: the machine's cores); 0 runs in this thread. */
  workers?: number;
  onResult?: (done: number, total: number, job: Job, r: JobResult) => void;
}

export const defaultWorkers = (): number => Math.max(1, cpus().length);

const variantKey = (j: Job) => (j.variant ? j.variant.label : '');

interface Slot {
  key: string | null;
  worker: Worker | null;
  busy: boolean;
}

/** Runs every job; results come back in job order. */
export async function runJobs(jobs: Job[], o: PoolOptions = {}): Promise<JobResult[]> {
  const n = o.workers ?? defaultWorkers();
  const out = new Array<JobResult>(jobs.length);
  let done = 0;
  const file = n > 0 ? await workerBundle() : null;
  if (!file) {
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].variant && Object.keys(jobs[i].variant!.overrides).length) throw new Error('params variants need worker threads (esbuild); rerun with workers > 0');
      out[i] = runJob(jobs[i]);
      o.onResult?.(++done, jobs.length, jobs[i], out[i]);
    }
    return out;
  }
  // Pending job indices per variant, in job order.
  const queues = new Map<string, number[]>();
  jobs.forEach((j, i) => {
    const k = variantKey(j);
    if (!queues.has(k)) queues.set(k, []);
    queues.get(k)!.push(i);
  });
  const slots: Slot[] = Array.from({ length: Math.min(n, jobs.length) }, () => ({ key: null, worker: null, busy: false }));

  const spawn = (slot: Slot, key: string, variant: Job['variant']): Promise<void> =>
    new Promise((resolve, reject) => {
      if (slot.worker) void slot.worker.terminate();
      const w = new Worker(file, { workerData: { variant } });
      slot.worker = w;
      slot.key = key;
      const onReady = (m: { ready?: boolean }) => {
        if (m.ready) {
          w.off('message', onReady);
          resolve();
        }
      };
      w.on('message', onReady);
      w.once('error', reject);
    });

  const runOn = (slot: Slot, i: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const w = slot.worker!;
      const onMsg = (m: { id: number; ok: boolean; result?: JobResult; error?: string }) => {
        if (m.id !== i) return;
        w.off('message', onMsg);
        w.off('error', onErr);
        if (!m.ok) return reject(new Error(`job ${i} failed: ${m.error}`));
        out[i] = m.result!;
        o.onResult?.(++done, jobs.length, jobs[i], out[i]);
        resolve();
      };
      const onErr = (e: Error) => reject(e);
      w.on('message', onMsg);
      w.once('error', onErr);
      w.postMessage({ id: i, job: jobs[i] });
    });

  /** The next job for a slot: its own variant first (no respawn), else the longest queue. */
  const next = (slot: Slot): number | null => {
    if (slot.key !== null) {
      const q = queues.get(slot.key);
      if (q && q.length) return q.shift()!;
    }
    let best: string | null = null;
    for (const [k, q] of queues) if (q.length && (best === null || q.length > queues.get(best)!.length)) best = k;
    return best === null ? null : queues.get(best)!.shift()!;
  };

  const loop = async (slot: Slot) => {
    for (;;) {
      const i = next(slot);
      if (i === null) break;
      const key = variantKey(jobs[i]);
      if (slot.key !== key || !slot.worker) await spawn(slot, key, jobs[i].variant);
      await runOn(slot, i);
    }
  };
  try {
    await Promise.all(slots.map(loop));
  } finally {
    await Promise.all(slots.map((s) => s.worker?.terminate()));
  }
  return out;
}
