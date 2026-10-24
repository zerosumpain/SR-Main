// A Lab worker thread (spec §11.1: a worker_threads pool on porkserv's 4
// cores). It applies its variant before anything resolves the params, then
// runs whatever jobs the pool sends, one at a time.

import { parentPort, workerData } from 'node:worker_threads';
import { runJob, type Job } from './jobs';
import { applyVariant, type Variant } from './variant';

const data = workerData as { variant: Variant | null };
applyVariant(data.variant);

parentPort!.on('message', (msg: { id: number; job: Job }) => {
  try {
    parentPort!.postMessage({ id: msg.id, ok: true, result: runJob(msg.job) });
  } catch (e) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
});
parentPort!.postMessage({ ready: true });
