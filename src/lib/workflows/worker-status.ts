/** Versioned wire record written only by the Workflows scheduler leader. */
export const WORKER_STATUS_KEY = 'workflows.worker-status.v1';
export const WORKER_STATUS_MAX_AGE_MS = 35_000;
export interface WorkerJob { scheduleId: string; nextRunMs: number | null; paused: boolean }
export interface WorkerSnapshot {
  version: 1;
  workerId: string;
  observedAt: number;
  jobs: WorkerJob[];
}
export type WorkerStatus =
  | { available: true; snapshot: WorkerSnapshot }
  | { available: false; reason: 'missing' | 'stale' | 'invalid' | 'unreachable' };

export function parseWorkerStatus(value: unknown, now = Date.now()): WorkerStatus {
  if (value == null) return { available: false, reason: 'missing' };
  const s = value as Partial<WorkerSnapshot>;
  if (s.version !== 1 || typeof s.workerId !== 'string' || !s.workerId ||
      typeof s.observedAt !== 'number' || !Number.isFinite(s.observedAt) ||
      !Array.isArray(s.jobs) || !s.jobs.every(j => j && typeof j.scheduleId === 'string' &&
        typeof j.paused === 'boolean' && (j.nextRunMs === null ||
          (typeof j.nextRunMs === 'number' && Number.isFinite(j.nextRunMs))))) {
    return { available: false, reason: 'invalid' };
  }
  if (now - s.observedAt > WORKER_STATUS_MAX_AGE_MS || s.observedAt > now + 5_000) {
    return { available: false, reason: 'stale' };
  }
  return { available: true, snapshot: s as WorkerSnapshot };
}
