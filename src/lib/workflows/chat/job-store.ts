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

export type JobPhase =
  | 'starting'
  | 'thinking'
  | 'tool_running'
  | 'waiting_llm'
  | 'finalising'
  | 'subagent';

export type JobEvent =
  | { type: 'token'; delta: string }
  // Hermes `replace` frame: overwrite the in-flight bubble's content with
  // the full new body (the model issued a revision, not an append).
  | { type: 'replace_bubble'; content: string }
  // Hermes `thinking` frame: a reasoning-delta routed to the collapsible
  // Reasoning panel beside the in-flight assistant bubble. Eliminates the
  // dead-air window on reasoning-heavy turns (GLM-5, Claude extended
  // thinking) by surfacing model deliberation before the first answer
  // token arrives.
  | { type: 'thinking'; delta: string; messageId?: string }
  | { type: 'tool_start'; tool: string; args: Record<string, unknown>; toolCallId?: string; summary?: string }
  | { type: 'tool_result'; tool: string; result: unknown; status: 'done' | 'error'; toolCallId?: string; summary?: string }
  | { type: 'status'; text: string }
  | { type: 'heartbeat'; summary: string; phase: JobPhase; elapsedMs: number }
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
    const job = jobs.get(jobId);
    if (job) {
      const elapsedMs = Date.now() - job.startedAt;
      const summary = event.type === 'error'
        ? (event.message ?? 'error').slice(0, 140)
        : 'done';
      recordPulse({
        ts: Date.now(),
        jobId,
        kind: event.type === 'done' ? 'job_done' : 'job_error',
        phase: job.phase,
        summary,
        elapsedMs,
      });
    }
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
  chatNodeId?: string | null;
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
  phase: JobPhase;
  lastHeartbeatAt: number;
  heartbeat?: ReturnType<typeof setInterval>;
  lastHeartbeatPayload?: { summary: string; phase: JobPhase };
  // Aggregated assistant tokens. The orchestrator endpoint appends each
  // streamed `token` event's delta here so a user-initiated cancel can
  // persist what was streamed so far instead of throwing it away.
  partialResponse: string;
}

const jobs = new Map<string, OrchestratorJob>();

// If no non-heartbeat progress event for this long, the job is considered
// stuck. Heartbeats deliberately do NOT reset this timer (otherwise a job
// stuck on "Calling LLM…" would never time out). The narration ticker in
// general-chat.ts emits `status` events every 20s during silent reasoning,
// which DO reset this — so genuine reasoning latency on GLM-5.x (60-180s
// before first token) is tolerated, but a truly hung job still trips at 4min.
const IDLE_TIMEOUT_MS = 240_000; // 4 min idle
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
      const phaseLabel = `${job.phase}${job.currentStep ? `: ${job.currentStep}` : ''}`;
      const reason = elapsed > HARD_TIMEOUT_MS
        ? `Job exceeded max duration (${Math.round(HARD_TIMEOUT_MS / 1000)}s) while ${phaseLabel}`
        : `Job idle for ${Math.round(idle / 1000)}s while ${phaseLabel} — likely stuck`;
      console.warn(`[orchestrator] Watchdog terminating job ${jobId}: ${reason}`);
      recordPulse({ ts: now, jobId, kind: 'watchdog_kill', phase: job.phase, summary: reason.slice(0, 140), elapsedMs: elapsed });
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

// Fixed-cadence heartbeat: fire unconditionally every 5s while the job is
// running. The client deduplicates if the (phase, summary) pair is identical
// to the previous tick. This removes the entire class of "did silence
// detection miss an edge?" bugs.
const HEARTBEAT_INTERVAL_MS = 5_000;

// Ring buffer of recent pulse events across all jobs. Used by /admin/pulse to
// render the live tick stream. Cap so a long-lived process doesn't grow it
// unbounded. Each tick includes the jobId so the page can group by job.
export interface PulseEvent {
  ts: number;
  jobId: string;
  kind: 'heartbeat' | 'phase_change' | 'watchdog_kill' | 'job_start' | 'job_done' | 'job_error';
  phase: JobPhase;
  summary: string;
  elapsedMs: number;
}
const PULSE_BUFFER_SIZE = 200;
const recentPulses: PulseEvent[] = [];
function recordPulse(p: PulseEvent): void {
  recentPulses.push(p);
  if (recentPulses.length > PULSE_BUFFER_SIZE) recentPulses.shift();
}
export function getRecentPulses(): PulseEvent[] {
  return recentPulses.slice().reverse();
}

function phaseLabel(phase: JobPhase): string {
  switch (phase) {
    // 'starting' is the default phase the server sits in until something more
    // specific happens (first token, tool_start, or an explicit setJobPhase).
    // "Connecting…" is a more honest user-facing label — the model has not
    // told us it's doing anything yet, only that the run was created.
    case 'starting': return 'Connecting…';
    case 'thinking': return 'Thinking';
    case 'tool_running': return 'Running tool';
    case 'waiting_llm': return 'Drafting reply';
    case 'finalising': return 'Finalising';
    case 'subagent': return 'Sub-agent working';
  }
}

function startHeartbeat(jobId: string, job: OrchestratorJob): void {
  job.heartbeat = setInterval(() => {
    if (job.status !== 'running') {
      if (job.heartbeat) clearInterval(job.heartbeat);
      job.heartbeat = undefined;
      return;
    }
    const now = Date.now();
    const summary = (
      job.currentStep ??
      job.progress[job.progress.length - 1] ??
      phaseLabel(job.phase) + '…'
    ).trim().slice(0, 140);
    const phase = job.phase;
    job.lastHeartbeatAt = now;
    job.lastHeartbeatPayload = { summary, phase };
    const elapsedMs = now - job.startedAt;
    console.log(`[hb] ${jobId} ${phase} ${Math.round(elapsedMs / 1000)}s "${summary}"`);
    recordPulse({ ts: now, jobId, kind: 'heartbeat', phase, summary, elapsedMs });
    publishJobEvent(jobId, {
      type: 'heartbeat',
      summary,
      phase,
      elapsedMs,
    });
  }, HEARTBEAT_INTERVAL_MS);
}

export function setJobPhase(jobId: string, phase: JobPhase, currentStep?: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const changed = job.phase !== phase || (currentStep && job.currentStep !== currentStep);
  job.phase = phase;
  if (currentStep) job.currentStep = currentStep;
  if (changed) {
    // Fire an immediate heartbeat on phase change so the UI updates without
    // waiting up to 5s for the next ticker firing.
    const now = Date.now();
    const summary = (job.currentStep ?? phaseLabel(phase) + '…').trim().slice(0, 140);
    job.lastHeartbeatAt = now;
    job.lastHeartbeatPayload = { summary, phase };
    const elapsedMs = now - job.startedAt;
    console.log(`[hb] ${jobId} ${phase} ${Math.round(elapsedMs / 1000)}s "${summary}" (phase change)`);
    recordPulse({ ts: now, jobId, kind: 'phase_change', phase, summary, elapsedMs });
    publishJobEvent(jobId, {
      type: 'heartbeat',
      summary,
      phase,
      elapsedMs,
    });
  }
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
    scope: {
      workflowId: scope.workflowId ?? null,
      conversationId: scope.conversationId ?? null,
      chatNodeId: scope.chatNodeId ?? null,
    },
    lastEventAt: now,
    lastHeartbeatAt: now,
    phase: 'starting',
    partialResponse: '',
  };
  jobs.set(jobId, job);
  recordPulse({ ts: now, jobId, kind: 'job_start', phase: 'starting', summary: message.slice(0, 140), elapsedMs: 0 });
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
  setTimeout(() => {
    const job = jobs.get(jobId);
    if (job) {
      if (job.watchdog) { clearInterval(job.watchdog); job.watchdog = undefined; }
      if (job.heartbeat) { clearInterval(job.heartbeat); job.heartbeat = undefined; }
    }
    jobs.delete(jobId);
  }, delayMs);
}

export function listJobs(): Array<{
  id: string;
  status: string;
  message: string;
  startedAt: number;
  progressCount: number;
  elapsed: number;
  phase: JobPhase;
  currentStep?: string;
  lastEventAt: number;
  lastHeartbeatAt: number;
  workflowId?: string | null;
  conversationId?: string | null;
  chatNodeId?: string | null;
}> {
  return Array.from(jobs.entries()).map(([id, job]) => ({
    id,
    status: job.status,
    message: job.message,
    startedAt: job.startedAt,
    progressCount: job.progress.length,
    elapsed: Date.now() - job.startedAt,
    phase: job.phase,
    currentStep: job.currentStep,
    lastEventAt: job.lastEventAt,
    lastHeartbeatAt: job.lastHeartbeatAt,
    workflowId: job.scope.workflowId ?? null,
    conversationId: job.scope.conversationId ?? null,
    chatNodeId: job.scope.chatNodeId ?? null,
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
