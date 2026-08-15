// Type-only: `credential-requests` reaches the DB transitively, so a value
// import here would drag server code into any client bundle that types a
// JobEvent. `import type` is erased at compile.
import type { SecretRequestEvent, SecretUpdateEvent } from '$lib/secrets/credential-requests';

/** One sub-agent row under a `delegate_task` tool step (sub-agent visualizer).
 *  Parsed adapter-side from the delegation result, so the full child summary +
 *  tool trace survive the per-tool result preview cap. */
export interface DelegateChild {
  index: number;
  status: string;
  summary: string;
  apiCalls?: number;
  durationSeconds?: number;
  model?: string | null;
  exitReason?: string | null;
  toolTrace: { tool: string; status: string }[];
}

export interface ToolProgressStep {
  tool: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'running' | 'done' | 'error';
  // Sub-agent rows for a `delegate_task` step (one per child task).
  children?: DelegateChild[];
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
  | { type: 'tool_result'; tool: string; result: unknown; status: 'done' | 'error'; toolCallId?: string; summary?: string; children?: DelegateChild[] }
  | { type: 'status'; text: string }
  | { type: 'heartbeat'; summary: string; phase: JobPhase; elapsedMs: number }
  | { type: 'plan'; planId: string; plan: PlanPayload }
  | { type: 'plan_ack'; planId: string; decision: 'approved' | 'rejected' | 'adjusted'; adjustment?: string }
  | { type: 'confirm'; confirmId: string; prompt: string; destructive?: boolean; details?: Record<string, unknown> }
  | { type: 'confirm_ack'; confirmId: string; decision: 'approved' | 'rejected' }
  | { type: 'clarify'; clarifyId: string; questions: ClarifyQuestion[] }
  | { type: 'clarify_ack'; clarifyId: string; answers: Record<string, string> }
  // Credential request. Every field here is SERVER-AUTHORED from the code
  // catalogue in $lib/secrets/credential-requests — the model contributes only a
  // provider key (validated against that table) and `reason`. There is
  // deliberately no field on either event that can carry a secret value: the
  // browser posts the value straight to /api/admin/apis/secrets and reports back
  // only that it stored it. See SecretRequestModal + secret-gate.
  //
  // Two variants share the event: a CREATE names a provider from that table and
  // describes the row about to be written; an UPDATE names an existing handle
  // and describes the change to it. Both are authored server-side, and the
  // update variant additionally has its write registered under `requestId` in
  // $lib/secrets/pending-updates so the browser cannot alter where the
  // credential ends up. The `kind` discriminant is absent on create, for
  // backwards compatibility with clients that predate updates.
  | ({ type: 'secret_request' } & (SecretRequestEvent | SecretUpdateEvent))
  | { type: 'secret_ack'; requestId: string; handle?: string; stored: boolean }
  // Dangerous-command approval gate surfaced by the Hermes plugin's
  // `send_exec_approval` (kind="approval" frame). The card's buttons reply
  // `/approve` | `/deny`, resolved gateway-side by the chat's session_key — so
  // there's no `_ack` correlation event, unlike confirm/clarify.
  | { type: 'approval'; command: string; description: string; sessionKey: string }
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
  // `seq` is the event's index in `buffer` — the SSE endpoint publishes it as
  // the frame's `id:` so a reconnect can resume rather than replay.
  subscribers: Set<(event: JobEvent, seq: number) => void>;
  closed: boolean;
}

const streams = new Map<string, JobStream>();

// External side-effect hook fired after every published event. Used by
// wa-escalation to ping WhatsApp when a waiter opens or a job ends and the
// user isn't attached. Set via registerEventHook from hooks.server.ts so the
// job-store stays free of WA / I/O dependencies.
type ExternalEventHook = (jobId: string, event: JobEvent) => void;
let externalEventHook: ExternalEventHook | null = null;
export function registerEventHook(hook: ExternalEventHook | null): void {
  externalEventHook = hook;
}

export function publishJobEvent(jobId: string, event: JobEvent): void {
  let stream = streams.get(jobId);
  if (!stream) {
    stream = { buffer: [], subscribers: new Set(), closed: false };
    streams.set(jobId, stream);
  }
  if (stream.closed) return;
  const seq = stream.buffer.length;
  stream.buffer.push(event);
  // Reset idle watchdog on any non-heartbeat event. Heartbeats are
  // informational and must not mask a genuinely stuck job.
  if (event.type !== 'heartbeat') {
    const job = jobs.get(jobId);
    if (job) job.lastEventAt = Date.now();
  }
  // Track in-flight delegations so the watchdog treats the ensuing parent
  // silence as "sub-agent working", not "stuck", and the heartbeat says so.
  if (event.type === 'tool_start' && event.tool === 'delegate_task') {
    const job = jobs.get(jobId);
    if (job) {
      job.activeDelegations += 1;
      job.phase = 'subagent';
    }
  } else if (event.type === 'tool_result' && event.tool === 'delegate_task') {
    const job = jobs.get(jobId);
    if (job) {
      job.activeDelegations = Math.max(0, job.activeDelegations - 1);
      // Parent has the child summary and is reasoning over it again.
      if (job.activeDelegations === 0 && job.phase === 'subagent') job.phase = 'thinking';
    }
  } else if (event.type === 'tool_start') {
    // Same treatment for an ordinary tool call: busy but silent. A delegation
    // outranks it though — a sub-agent's own tool calls arrive on the parent
    // job, and letting them claim the phase means the FIRST of them to finish
    // reports 'thinking' while the sub-agent is still working. The watchdog
    // keys off the counters so it is unaffected, but the heartbeat the user
    // sees and the reap message's phase label would both be wrong.
    const job = jobs.get(jobId);
    if (job) {
      job.activeTools += 1;
      if (job.activeDelegations === 0) job.phase = 'tool_running';
    }
  } else if (event.type === 'tool_result') {
    const job = jobs.get(jobId);
    if (job) {
      job.activeTools = Math.max(0, job.activeTools - 1);
      if (job.activeTools === 0 && job.phase === 'tool_running') {
        job.phase = job.activeDelegations > 0 ? 'subagent' : 'thinking';
      }
    }
  }
  for (const sub of stream.subscribers) {
    try { sub(event, seq); } catch { /* ignore broken subscriber */ }
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
  if (externalEventHook) {
    try { externalEventHook(jobId, event); } catch (err) {
      console.error('[job-store] external event hook threw:', err);
    }
  }
}

/**
 * Attach to a job's event stream.
 *
 * The handler is given each event's **sequence number** — its index in the
 * job's buffer — as well as the event. That number is what the SSE endpoint
 * publishes as the frame's `id:`, so a reconnecting client can say where it got
 * to via `fromSeq` and be replayed only what it missed. Without it every
 * reconnect replayed the whole buffer into a handler that appends, and the
 * bubble silently doubled — invisible in the DB, because the server accumulates
 * independently, which is why "a reload fixes it".
 */
export function subscribeJob(
  jobId: string,
  handler: (event: JobEvent, seq: number) => void,
  fromSeq = 0,
): () => void {
  let stream = streams.get(jobId);
  if (!stream) {
    stream = { buffer: [], subscribers: new Set(), closed: false };
    streams.set(jobId, stream);
  }
  // Replay the part of the buffer this subscriber has not seen.
  const start = Math.max(0, Math.min(fromSeq, stream.buffer.length));
  for (let i = start; i < stream.buffer.length; i++) handler(stream.buffer[i], i);
  const sub = (event: JobEvent, seq: number) => handler(event, seq);
  stream.subscribers.add(sub);
  return () => {
    stream?.subscribers.delete(sub);
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
  // Set the first time a waiter (plan / clarify / confirm) is opened on
  // this job and cleared once every waiter is resolved. While non-null,
  // the watchdog applies WAITER_IDLE_TIMEOUT_MS instead of IDLE_TIMEOUT_MS
  // so an unattended user-input gate doesn't reap the job after 4 min.
  waiterOpenedAt: number | null;
  // Count of in-flight `delegate_task` calls (started but not yet resolved).
  // A synchronous delegation is BUSY, not idle — Hermes runs the child agents
  // in worker threads and, by design, does not stream their intermediate tool
  // calls back to the parent, so the parent's SSE stream goes silent for the
  // whole delegation. Without this the 4-min idle watchdog reaps a perfectly
  // healthy job mid-delegation ("likely stuck"). While >0 the watchdog applies
  // the delegation limits below instead of the normal idle limit.
  activeDelegations: number;
  // Count of in-flight tool calls that are NOT delegations. Hermes emits
  // nothing at all between `tool_start` and `tool_result`, so a single long
  // tool call (a canvas `workflow_run`, a deep scrape, a slow MCP round-trip)
  // looks exactly like a hung job. It used to be rescued by accident: the
  // gateway's 3-minute "⏳ Working…" filler arrived as a text frame and reset
  // the idle timer. That filler is now routed off the text channel (and
  // switched off at the gateway), so the exemption has to be explicit — or a
  // legitimate 16-minute tool call is reaped at 4 min while Hermes carries on
  // producing the real answer into a dead stream.
  activeTools: number;
  // Set when this job's message is queued BEHIND another turn on the same
  // conversation, which happens when the gateway runs in `busy_input_mode:
  // queue`. Such a job produces nothing at all until the turn ahead of it
  // finishes — indistinguishable from stuck to the 4-min idle watchdog, which
  // would reap a perfectly healthy queued turn behind any long answer. Cleared
  // the moment its own first frame arrives.
  queuedBehind: string | null;
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
// While a waiter (plan / clarify / confirm) is open, the job is legitimately
// idle on the server side waiting for the user — extend the idle limit so it
// survives an overnight gap. The wa-escalation hook is the alert mechanism;
// this just stops the watchdog from killing the conversation mid-wait.
const WAITER_IDLE_TIMEOUT_MS = 24 * 60 * 60_000; // 24 h
const WAITER_HARD_TIMEOUT_MS = 48 * 60 * 60_000; // 48 h total cap with waiter open
// A `delegate_task` runs child agents that are busy but silent on the parent
// stream (Hermes surfaces only their final summary). Tolerate a long quiet spell
// — a node-builder sub-agent can churn for many minutes — while still keeping a
// generous hard cap so a genuinely wedged child is eventually reaped, not hung
// forever.
const DELEGATION_IDLE_TIMEOUT_MS = 30 * 60_000; // 30 min of parent silence while delegating
const DELEGATION_HARD_TIMEOUT_MS = 45 * 60_000; // 45 min total while a delegation is active
// An ordinary tool call is silent for its whole duration too. Sized just under
// Hermes' own `agent.gateway_timeout` (1800s in ~/.hermes-jkai/config.yaml) so
// Hermes — which owns the turn and can still deliver the answer — gives up
// first, rather than SvelteKit reaping a live stream out from under it.
const TOOL_IDLE_TIMEOUT_MS = 20 * 60_000; // 20 min inside a single tool call
// A queued turn is silent for exactly as long as the turn ahead of it runs, and
// that one is bounded by its own hard limit. Generous, because the alternative is
// reaping a turn that has not been given a chance to start.
const QUEUED_IDLE_TIMEOUT_MS = 30 * 60_000; // 30 min waiting to start
const TOOL_HARD_TIMEOUT_MS = 29 * 60_000; // 29 min total while a tool is running

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
    // Precedence: an open user-input waiter (longest) > an active delegation >
    // an active tool call > the normal idle limit. Both of the middle two are
    // busy-but-silent, so neither must be reaped at the 4-min idle mark.
    const delegating = job.activeDelegations > 0;
    const toolRunning = job.activeTools > 0;
    const idleLimit = job.queuedBehind
      ? QUEUED_IDLE_TIMEOUT_MS
      : job.waiterOpenedAt
      ? WAITER_IDLE_TIMEOUT_MS
      : delegating ? DELEGATION_IDLE_TIMEOUT_MS
      : toolRunning ? TOOL_IDLE_TIMEOUT_MS : IDLE_TIMEOUT_MS;
    const hardLimit = job.waiterOpenedAt
      ? WAITER_HARD_TIMEOUT_MS
      : delegating ? DELEGATION_HARD_TIMEOUT_MS
      : toolRunning ? TOOL_HARD_TIMEOUT_MS : HARD_TIMEOUT_MS;
    if (idle > idleLimit || elapsed > hardLimit) {
      const phaseLabel = `${job.phase}${job.currentStep ? `: ${job.currentStep}` : ''}`;
      const reason = elapsed > hardLimit
        ? `Job exceeded max duration (${Math.round(hardLimit / 1000)}s) while ${phaseLabel}`
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

// Ring buffer of recent pulse events across all jobs. Used by /admin/ops/live to
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
    waiterOpenedAt: null,
    activeDelegations: 0,
    activeTools: 0,
    queuedBehind: null,
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
 *
 * Returns the ids it cancelled, because the superseding job needs them: a second
 * message sent while the agent is answering does NOT start a second Hermes run —
 * the running one is redirected, or the text merged into it, and it keeps the
 * FIRST turn's stamp. The new job adopts these ids so it renders the output that
 * is actually answering it instead of rejecting it as another turn's. See
 * `frameBelongsToTurn`.
 */
export function cancelForScope(scope: JobScope, reason: string): string[] {
  if (!scope.workflowId && !scope.conversationId) return [];
  const cancelled: string[] = [];
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
    cancelled.push(id);
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
  /** Set while this turn is waiting for another on the same conversation. An
   *  operator reading the running-job list should see "waiting", not "stuck". */
  queuedBehind?: string | null;
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
    queuedBehind: job.queuedBehind,
  }));
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

const waiters = new Map<string, Map<string, Waiter>>();

function markWaiterOpen(jobId: string): void {
  const job = jobs.get(jobId);
  if (job && job.waiterOpenedAt == null) job.waiterOpenedAt = Date.now();
}

function clearWaiterIfDrained(jobId: string): void {
  const m = waiters.get(jobId);
  if (m && m.size > 0) return;
  const job = jobs.get(jobId);
  if (job) job.waiterOpenedAt = null;
}

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
  markWaiterOpen(jobId);
  return {
    awaitResponse: () => promise,
    respond: (value: T) => {
      const m = waiters.get(jobId); if (!m) return;
      const w = m.get(key); if (!w) return;
      m.delete(key);
      if (m.size === 0) waiters.delete(jobId);
      w.resolve(value);
      clearWaiterIfDrained(jobId);
    },
  };
}

export function respondToWaiter(jobId: string, key: string, value: unknown): boolean {
  const m = waiters.get(jobId); if (!m) return false;
  const w = m.get(key); if (!w) return false;
  m.delete(key);
  if (m.size === 0) waiters.delete(jobId);
  w.resolve(value);
  clearWaiterIfDrained(jobId);
  return true;
}

export function rejectWaiter(jobId: string, key: string, reason: string): void {
  const m = waiters.get(jobId); if (!m) return;
  const w = m.get(key); if (!w) return;
  m.delete(key);
  if (m.size === 0) waiters.delete(jobId);
  w.reject(new Error(reason));
  clearWaiterIfDrained(jobId);
}

// When a job ends (done / error / cancelled), reject every outstanding waiter
// so coroutines that awaited on user input stop leaking.
export function failAllWaiters(jobId: string, reason: string): void {
  const m = waiters.get(jobId); if (!m) return;
  for (const [, w] of m) w.reject(new Error(reason));
  waiters.delete(jobId);
  const job = jobs.get(jobId);
  if (job) job.waiterOpenedAt = null;
}

export function getStreamSubscriberCount(jobId: string): number {
  return streams.get(jobId)?.subscribers.size ?? 0;
}

export function listRunningJobsByConversation(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, job] of jobs) {
    if (job.status !== 'running') continue;
    const convId = job.scope.conversationId;
    if (!convId) continue;
    out.set(convId, id);
  }
  return out;
}

/**
 * Resolve when `jobId` is no longer running — immediately if it is already gone.
 *
 * Used to serialise a queued turn behind the one ahead of it. Polls rather than
 * hooking the job's completion, because a job can end by any of five routes
 * (done, error, explicit cancel, scope supersede, watchdog) and a missed hook
 * would hang a turn for its whole idle allowance. 250ms is far below anything a
 * user perceives at the end of a multi-second answer.
 */
export function whenJobSettles(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const current = jobs.get(jobId);
      if (!current || current.status !== 'running') {
        clearInterval(timer);
        resolve();
      }
    }, 250);
    // Do not hold the process open on this alone.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  });
}

/**
 * Mark `jobId` as waiting for `behindJobId` to finish before its own turn starts.
 *
 * Only meaningful when the gateway queues rather than interrupts. It exempts the
 * job from the idle watchdog while it has nothing to say, and nothing else.
 */
export function markJobQueued(jobId: string, behindJobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.queuedBehind = behindJobId;
}

/** Its turn has started — normal watchdog limits apply again. */
export function clearJobQueued(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job || !job.queuedBehind) return;
  job.queuedBehind = null;
  job.lastEventAt = Date.now();
}

export function getRunningJobIdForConversation(conversationId: string): string | null {
  for (const [id, job] of jobs) {
    if (job.status !== 'running') continue;
    if (job.scope.conversationId === conversationId) return id;
  }
  return null;
}
