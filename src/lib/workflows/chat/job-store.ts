export interface ToolProgressStep {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

export interface OrchestratorJob {
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: string[];
  toolSteps: ToolProgressStep[];
  result?: Record<string, unknown>;
  error?: string;
  abortController: AbortController;
  startedAt: number;
  message: string;
}

const jobs = new Map<string, OrchestratorJob>();

export function createJob(message: string): { jobId: string; job: OrchestratorJob } {
  const jobId = crypto.randomUUID();
  const job: OrchestratorJob = {
    status: 'running',
    progress: [],
    toolSteps: [],
    abortController: new AbortController(),
    startedAt: Date.now(),
    message: message.slice(0, 100),
  };
  jobs.set(jobId, job);
  return { jobId, job };
}

export function getJob(jobId: string): OrchestratorJob | null {
  return jobs.get(jobId) ?? null;
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.abortController.abort();
  job.status = 'cancelled';
  job.error = 'Cancelled by user';
  job.result = { success: false, error: 'Cancelled by user' };
  return true;
}

export function cancelAllRunning(reason: string): void {
  for (const [id, job] of jobs) {
    if (job.status === 'running') {
      console.log(`[orchestrator] Cancelling job ${id}: ${reason}`);
      job.abortController.abort();
      job.status = 'cancelled';
      job.error = reason;
      job.result = { success: false, error: reason };
    }
  }
}

export function cleanOldJobs(maxAgeMs = 300000): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && (maxAgeMs === 0 || now - job.startedAt > maxAgeMs)) {
      jobs.delete(id);
    }
    if (job.status === 'running' && now - job.startedAt > 600000) {
      job.abortController.abort();
      job.status = 'error';
      job.error = 'Job timed out (10 min limit)';
      job.result = { success: false, error: job.error };
      jobs.delete(id);
    }
  }
}

export function deleteJob(jobId: string, delayMs = 30000): void {
  setTimeout(() => jobs.delete(jobId), delayMs);
}

export function listJobs(): Array<{
  id: string;
  status: string;
  message: string;
  startedAt: number;
  progressCount: number;
  elapsed: number;
}> {
  return Array.from(jobs.entries()).map(([id, job]) => ({
    id,
    status: job.status,
    message: job.message,
    startedAt: job.startedAt,
    progressCount: job.progress.length,
    elapsed: Date.now() - job.startedAt,
  }));
}
