import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseWorkerStatus, WORKER_STATUS_KEY, type WorkerStatus } from './worker-status';

/** Unknown is not an empty job list: only the worker knows its registrations. */
export async function readWorkerStatus(): Promise<WorkerStatus> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings)
      .where(eq(appSettings.key, WORKER_STATUS_KEY)).limit(1);
    return parseWorkerStatus(row?.value);
  } catch {
    return { available: false, reason: 'unreachable' };
  }
}
