export interface ToolProgressStep {
  tool: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
}

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  kind?: 'read' | 'write' | 'run' | 'external';
}

export interface PlanPayload {
  steps: PlanStep[];
  filesToTouch: Array<{ path: string; action: 'create' | 'modify' | 'delete' }>;
  summary?: string;
  estimatedSteps?: number;
}

export interface ClarifyQuestion {
  id: string;
  text: string;
  kind?: 'freeform' | 'choice';
  choices?: string[];
}

export type JobEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown>; toolCallId?: string }
  | { type: 'tool_result'; tool: string; result: unknown; status: 'done' | 'error'; toolCallId?: string; summary?: string }
  | { type: 'status'; text: string }
  | { type: 'heartbeat'; summary: string; elapsedMs: number; currentStep?: string }
  | { type: 'plan'; planId: string; plan: PlanPayload }
  | { type: 'plan_ack'; planId: string; decision: 'approved' | 'rejected' | 'adjusted'; adjustment?: string }
  | { type: 'confirm'; confirmId: string; prompt: string; destructive?: boolean; details?: Record<string, unknown> }
  | { type: 'confirm_ack'; confirmId: string; decision: 'approved' | 'rejected' }
  | { type: 'clarify'; clarifyId: string; questions: ClarifyQuestion[] }
  | { type: 'clarify_ack'; clarifyId: string; answers: Record<string, string> }
  | { type: 'subagent_start'; agentId: string; parentStepId: string | null; task: string }
  // Recursive reference: consumers that narrow on `event.type` inside a `subagent_event`
  // must do so non-generically to avoid TS instantiation-depth issues. The SSE path
  // treats it as opaque JSON, which is safe.
  | { type: 'subagent_event'; agentId: string; event: JobEvent }
  | { type: 'subagent_done'; agentId: string; summary: string; result: unknown }
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
  // Reset idle watchdog on any non-heartbeat event. Heartbeats are
  // informational and must not mask a genuinely stuck job.
  if (event.type !== 'heartbeat') {
    const job = jobs.get(jobId);
    if (job) job.lastEventAt = Date.now();
  }
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

export interface JobScope {
  workflowId?: string | null;
  conversationId?: string | null;
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
  scope: JobScope;
  lastEventAt: number;
  watchdog?: ReturnType<typeof setInterval>;
  currentStep?: string;       // short description updated by onProgress / tool_start for heartbeat summaries
  lastHeartbeatAt: number;
  heartbeat?: ReturnType<typeof setInterval>;
}

const jobs = new Map<string, OrchestratorJob>();

// If no event for this long, the job is considered stuck and we publish a
// terminal error so SSE subscribers stop waiting. Tuned to outlast a typical
// long LLM generation but catch real hangs (e.g. provider that never returns).
const IDLE_TIMEOUT_MS = 180_000; // 3 min idle
const HARD_TIMEOUT_MS = 600_000; // 10 min total

function startWatchdog(jobId: string, job: OrchestratorJob): void {
  job.watchdog = setInterval(() => {
    if (job.status !== 'running') {
      if (job.watchdog) clearInterval(job.watchdog);
      job.watchdog = undefined;
      if (job.heartbeat) clearInterval(job.heartbeat);
      job.heartbeat = undefined;
      return;
    }
    const now = Date.now();
    const idle = now - job.lastEventAt;
    const elapsed = now - job.startedAt;
    if (idle > IDLE_TIMEOUT_MS || elapsed > HARD_TIMEOUT_MS) {
      const reason = elapsed > HARD_TIMEOUT_MS
        ? `Job exceeded max duration (${Math.round(HARD_TIMEOUT_MS / 1000)}s)`
        : `Job idle for ${Math.round(idle / 1000)}s — likely stuck`;
      console.warn(`[orchestrator] Watchdog terminating job ${jobId}: ${reason}`);
      job.abortController.abort();
      job.status = 'error';
      job.error = reason;
      job.result = { success: false, error: reason };
      if (job.watchdog) clearInterval(job.watchdog);
      job.watchdog = undefined;
      if (job.heartbeat) clearInterval(job.heartbeat);
      job.heartbeat = undefined;
      publishJobEvent(jobId, { type: 'error', message: reason });
      failAllWaiters(jobId, reason);
    }
  }, 15_000);
}

const HEARTBEAT_CHECK_INTERVAL_MS = 5_000;   // check every 5s
const HEARTBEAT_MIN_SILENCE_MS = 25_000;     // only emit after 25s of silence

function startHeartbeat(jobId: string, job: OrchestratorJob): void {
  job.heartbeat = setInterval(() => {
    if (job.status !== 'running') {
      if (job.heartbeat) clearInterval(job.heartbeat);
      job.heartbeat = undefined;
      return;
    }
    const now = Date.now();
    const sinceEvent = now - job.lastEventAt;
    const sinceHeartbeat = now - job.lastHeartbeatAt;
    if (sinceEvent >= HEARTBEAT_MIN_SILENCE_MS && sinceHeartbeat >= HEARTBEAT_MIN_SILENCE_MS) {
      const summary =
        job.currentStep ??
        job.progress[job.progress.length - 1] ??
        'Still thinking...';
      job.lastHeartbeatAt = now;
      publishJobEvent(jobId, {
        type: 'heartbeat',
        summary: summary.trim().slice(0, 140),
        elapsedMs: now - job.startedAt,
        currentStep: job.currentStep,
      });
    }
  }, HEARTBEAT_CHECK_INTERVAL_MS);
}

export function createJob(message: string, scope: JobScope = {}): { jobId: string; job: OrchestratorJob } {
  const jobId = crypto.randomUUID();
  const now = Date.now();
  const job: OrchestratorJob = {
    status: 'running',
    progress: [],
    toolSteps: [],
    abortController: new AbortController(),
    startedAt: now,
    message: message.slice(0, 100),
    scope: { workflowId: scope.workflowId ?? null, conversationId: scope.conversationId ?? null },
    lastEventAt: now,
    lastHeartbeatAt: now,
  };
  jobs.set(jobId, job);
  startWatchdog(jobId, job);
  startHeartbeat(jobId, job);
  return { jobId, job };
}

export function getJob(jobId: string): OrchestratorJob | null {
  return jobs.get(jobId) ?? null;
}

export function touchJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (job) job.lastEventAt = Date.now();
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.abortController.abort();
  job.status = 'cancelled';
  job.error = 'Cancelled by user';
  job.result = { success: false, error: 'Cancelled by user' };
  if (job.watchdog) { clearInterval(job.watchdog); job.watchdog = undefined; }
  if (job.heartbeat) { clearInterval(job.heartbeat); job.heartbeat = undefined; }
  publishJobEvent(jobId, { type: 'error', message: 'Cancelled by user' });
  failAllWaiters(jobId, 'Cancelled by user');
  return true;
}

function scopeMatches(job: OrchestratorJob, scope: JobScope): boolean {
  if (scope.workflowId && job.scope.workflowId === scope.workflowId) return true;
  if (scope.conversationId && job.scope.conversationId === scope.conversationId) return true;
  return false;
}

/**
 * Cancel only running jobs whose scope matches the given workflowId or
 * conversationId. A new request within the same canvas/conversation
 * supersedes its own prior in-flight job, but leaves other users' or
 * other canvases' jobs alone.
 */
export function cancelForScope(scope: JobScope, reason: string): number {
  if (!scope.workflowId && !scope.conversationId) return 0;
  let cancelled = 0;
  for (const [id, job] of jobs) {
    if (job.status !== 'running') continue;
    if (!scopeMatches(job, scope)) continue;
    console.log(`[orchestrator] Cancelling job ${id} (scope match): ${reason}`);
    job.abortController.abort();
    job.status = 'cancelled';
    job.error = reason;
    job.result = { success: false, error: reason };
    if (job.watchdog) { clearInterval(job.watchdog); job.watchdog = undefined; }
    if (job.heartbeat) { clearInterval(job.heartbeat); job.heartbeat = undefined; }
    publishJobEvent(id, { type: 'error', message: reason });
    failAllWaiters(id, reason);
    cancelled += 1;
  }
  return cancelled;
}

/** Cancel every running job. Used only by the explicit admin DELETE with no jobId. */
export function cancelAllRunning(reason: string): void {
  for (const [id, job] of jobs) {
    if (job.status === 'running') {
      console.log(`[orchestrator] Cancelling job ${id}: ${reason}`);
      job.abortController.abort();
      job.status = 'cancelled';
      job.error = reason;
      job.result = { success: false, error: reason };
      if (job.watchdog) { clearInterval(job.watchdog); job.watchdog = undefined; }
      if (job.heartbeat) { clearInterval(job.heartbeat); job.heartbeat = undefined; }
      publishJobEvent(id, { type: 'error', message: reason });
      failAllWaiters(id, reason);
    }
  }
}

export function cleanOldJobs(maxAgeMs = 300000): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && (maxAgeMs === 0 || now - job.startedAt > maxAgeMs)) {
      if (job.watchdog) { clearInterval(job.watchdog); job.watchdog = undefined; }
      if (job.heartbeat) { clearInterval(job.heartbeat); job.heartbeat = undefined; }
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

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

const waiters = new Map<string, Map<string, Waiter>>();

export function createWaiter<T = unknown>(
  jobId: string,
  key: string,
): { awaitResponse: () => Promise<T>; respond: (value: T) => void } {
  let map = waiters.get(jobId);
  if (!map) { map = new Map(); waiters.set(jobId, map); }
  let waiter: Waiter | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    waiter = { resolve: resolve as (v: unknown) => void, reject };
  });
  if (!waiter) throw new Error('waiter init failed');
  map.set(key, waiter);
  return {
    awaitResponse: () => promise,
    respond: (value: T) => {
      const m = waiters.get(jobId); if (!m) return;
      const w = m.get(key); if (!w) return;
      m.delete(key);
      if (m.size === 0) waiters.delete(jobId);
      w.resolve(value);
    },
  };
}

export function respondToWaiter(jobId: string, key: string, value: unknown): boolean {
  const m = waiters.get(jobId); if (!m) return false;
  const w = m.get(key); if (!w) return false;
  m.delete(key);
  if (m.size === 0) waiters.delete(jobId);
  w.resolve(value);
  return true;
}

export function rejectWaiter(jobId: string, key: string, reason: string): void {
  const m = waiters.get(jobId); if (!m) return;
  const w = m.get(key); if (!w) return;
  m.delete(key);
  if (m.size === 0) waiters.delete(jobId);
  w.reject(new Error(reason));
}

// When a job ends (done / error / cancelled), reject every outstanding waiter
// so coroutines that awaited on user input stop leaking.
export function failAllWaiters(jobId: string, reason: string): void {
  const m = waiters.get(jobId); if (!m) return;
  for (const [, w] of m) w.reject(new Error(reason));
  waiters.delete(jobId);
}
