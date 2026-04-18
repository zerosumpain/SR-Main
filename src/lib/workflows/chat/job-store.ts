export interface ToolProgressStep {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

export type JobEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; result: unknown; status: 'done' | 'error' }
  | { type: 'status'; text: string }
  | { type: 'done'; result: Record<string, unknown> }
  | { type: 'error'; message: string };

interface JobStream {
  buffer: JobEvent[];
  subscribers: Set<(event: JobEvent) => void>;
  closed: boolean;
}

const streams = new Map<string, JobStream>();

export function publishJobEvent(jobId: string, event: JobEvent): void {
  let stream = streams.get(jobId);
  if (!stream) {
    stream = { buffer: [], subscribers: new Set(), closed: false };
    streams.set(jobId, stream);
  }
  if (stream.closed) return;
  stream.buffer.push(event);
  for (const sub of stream.subscribers) {
    try { sub(event); } catch { /* ignore broken subscriber */ }
  }
  if (event.type === 'done' || event.type === 'error') {
    stream.closed = true;
    // Give late subscribers a moment to attach, then clean up
    setTimeout(() => streams.delete(jobId), 60_000);
  }
}

export function subscribeJob(jobId: string, handler: (event: JobEvent) => void): () => void {
  let stream = streams.get(jobId);
  if (!stream) {
    stream = { buffer: [], subscribers: new Set(), closed: false };
    streams.set(jobId, stream);
  }
  // Replay buffered events to new subscriber
  for (const ev of stream.buffer) handler(ev);
  stream.subscribers.add(handler);
  return () => {
    stream?.subscribers.delete(handler);
  };
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
