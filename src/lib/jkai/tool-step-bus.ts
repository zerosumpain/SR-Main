// In-memory pub-sub for canvas-chat tool-step events.
//
// Why this exists: when the Hermes branch is on (JKAI_HERMES_CANVAS_CHAT=1),
// /api/workflows/orchestrator/chat proxies the user message through the
// HermesClient + JkaiPlatformAdapter. The adapter only streams send/replace/
// finalize frames; it has no knowledge of structured tool-call events. Yet
// the canvas UI's tool-step panel (ChatArea.svelte) expects `tool_start` /
// `tool_result` events alongside `token` deltas to show "Hermes is calling
// workflow_add_node...".
//
// All Hermes tool calls flow through this SvelteKit process's MCP server
// (src/lib/mcp/jsonrpc.ts → executeTool). So that layer publishes a
// `ToolStepEvent` before and after every executeTool, keyed by the
// `workflow_id` argument. The Hermes branch in the chat route subscribes for
// the duration of the SSE response and merges those events into the same
// stream the legacy path already populates.
//
// In-memory; per-process; lost on SvelteKit restart. That's fine — the soak
// runs against the long-lived prod systemd service, and dev iteration is
// short-lived.

export interface ToolStepEvent {
  workflowId: string;
  stepId: string;          // unique per call, used to correlate started ↔ progress*/completed/failed
  // `progress` is emitted mid-call from inside the tool handler (via the ctx.emit
  // channel) so the chat UI can stream "Planning workflow…", "Reviewing…",
  // "Saving the finished canvas…" updates while a long-running tool is still in
  // flight. The MCP Streamable HTTP transport buffers the JSON-RPC response, but
  // this in-process bus bypasses it — subscribers on the same Node process see
  // progress events the moment they fire.
  phase: 'started' | 'progress' | 'completed' | 'failed';
  tool: string;
  args?: Record<string, unknown>;
  resultPreview?: string;   // truncated for UI display
  result?: unknown;         // full result (the subscriber decides what to surface)
  error?: string;
  summary?: string;         // short human-readable summary (parity with legacy emitter)
  ts: number;
}

/** A destructive tool call awaiting a human decision.
 *
 *  Raised by the MCP dispatcher (src/lib/mcp/jsonrpc.ts) when the resolved tool
 *  carries `destructive: true` in the registry. The MCP layer has no `jobId` —
 *  it only knows the same `busKey` this module is already keyed by — so the
 *  chat route registers the confirmer and owns the job-store round-trip. */
export interface ToolConfirmRequest {
  /** The REAL tool name, already resolved through the `jkai_extended`
   *  meta-dispatcher. Gating on the outer name would let every destructive
   *  call through unchallenged. */
  tool: string;
  /** User-facing question, from `describeDestructiveAction`. */
  prompt: string;
  args: Record<string, unknown>;
}

export interface ToolConfirmDecision {
  approved: boolean;
  /** Optional reason surfaced back to the agent on a denial. */
  reason?: string;
}

type Confirmer = (req: ToolConfirmRequest) => Promise<ToolConfirmDecision>;

type Listener = (e: ToolStepEvent) => void;

const listeners = new Map<string, Set<Listener>>();
// One confirmer per busKey — a chat has exactly one live job at a time
// (cancelForScope supersedes the previous one before a new turn starts).
const confirmers = new Map<string, Confirmer>();

export function publishToolStep(e: ToolStepEvent): void {
  const set = listeners.get(e.workflowId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(e);
    } catch {
      // A broken subscriber must not poison the publish loop. The bus is
      // best-effort: a thrown listener is dropped silently rather than
      // taking down the in-flight tool call.
    }
  }
}

export function subscribeToolSteps(workflowId: string, fn: Listener): () => void {
  if (!workflowId) return () => {};
  let set = listeners.get(workflowId);
  if (!set) {
    set = new Set();
    listeners.set(workflowId, set);
  }
  set.add(fn);
  return () => {
    const current = listeners.get(workflowId);
    if (!current) return;
    current.delete(fn);
    if (current.size === 0) listeners.delete(workflowId);
  };
}

/**
 * Attach a human-confirmation handler for `busKey`. Called by the chat route
 * alongside `subscribeToolSteps`, for the lifetime of the SSE response. The
 * returned closure unregisters — always call it in the same cleanup block as
 * the tool-step unsubscribe, or a stale confirmer will answer for a dead job.
 */
export function registerToolConfirmer(busKey: string, fn: Confirmer): () => void {
  if (!busKey) return () => {};
  confirmers.set(busKey, fn);
  return () => {
    if (confirmers.get(busKey) === fn) confirmers.delete(busKey);
  };
}

/** Whether a live confirmer is attached for this key (i.e. a human is reachable). */
export function hasToolConfirmer(busKey: string): boolean {
  return !!busKey && confirmers.has(busKey);
}

/**
 * Ask the human attached to `busKey` to approve a destructive tool call.
 *
 * Fails CLOSED in every ambiguous case — no confirmer, timeout, or a throwing
 * confirmer all resolve to `approved: false`. The wait budget is bounded well
 * under Hermes' hardcoded 300s httpx read timeout (tools/mcp_tool.py:1511,1556);
 * waiting past that strands the turn on a stale "Working…" instead of
 * protecting anything, since the MCP client has already given up.
 */
export const TOOL_CONFIRM_TIMEOUT_MS = 240_000;

export async function requestToolConfirmation(
  busKey: string,
  req: ToolConfirmRequest,
): Promise<ToolConfirmDecision> {
  const fn = busKey ? confirmers.get(busKey) : undefined;
  if (!fn) {
    // Unattended: a Hermes cron/WhatsApp session, or an external MCP client
    // with no /jkai tab open. Deny by default; `allow` restores the old
    // ungated behaviour for anyone who needs it.
    const policy = (process.env.MCP_CONFIRM_UNATTENDED ?? 'deny').toLowerCase();
    if (policy === 'allow') return { approved: true };
    return {
      approved: false,
      reason:
        'no user is attached to this session to confirm it (unattended MCP call)',
    };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decision = await Promise.race([
      fn(req),
      new Promise<ToolConfirmDecision>((resolve) => {
        timer = setTimeout(
          () => resolve({ approved: false, reason: 'the confirmation prompt timed out with no response' }),
          TOOL_CONFIRM_TIMEOUT_MS,
        );
      }),
    ]);
    return decision;
  } catch (err) {
    // A cancelled/reaped job rejects its waiters — that is a denial, not an
    // execution. Never fall through to running the tool.
    return {
      approved: false,
      reason: err instanceof Error ? err.message : 'confirmation was not obtained',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Credential requests
// ---------------------------------------------------------------------------
//
// Same shape as the confirmer above, for a different question: not "may I run
// this?" but "please hand me a credential I must never see". The value does NOT
// travel back through this bus — the browser posts it straight to the
// owner-gated secrets endpoint. What comes back here is only an outcome.

/** What the model asked for. `provider` is validated against a code table by
 *  the tool BEFORE it reaches here; nothing host- or handle-shaped from the
 *  model is carried on this request. */
export interface SecretRequest {
  provider: string;
  /** One sentence, rendered to the owner as quoted text — never as instruction. */
  reason: string;
  custom?: { label?: string; suggestedHost?: string; suggestedHandle?: string };
}

export interface SecretRequestOutcome {
  status: 'stored' | 'declined' | 'timeout' | 'unattended';
  /** Present only on 'stored'. A handle is not a value. */
  handle?: string;
}

type SecretRequester = (req: SecretRequest) => Promise<SecretRequestOutcome>;

const secretRequesters = new Map<string, SecretRequester>();

/** Attach a credential-request handler for `busKey`, for the lifetime of the
 *  SSE response. Unregister in the same cleanup block as the tool-step
 *  unsubscribe or a stale requester will answer for a dead job. */
export function registerSecretRequester(busKey: string, fn: SecretRequester): () => void {
  if (!busKey) return () => {};
  secretRequesters.set(busKey, fn);
  return () => {
    if (secretRequesters.get(busKey) === fn) secretRequesters.delete(busKey);
  };
}

/** Whether a browser is attached that could show the form. */
export function hasSecretRequester(busKey: string): boolean {
  return !!busKey && secretRequesters.has(busKey);
}

/**
 * Budget for the human to fetch a key out of a vendor console. Deliberately
 * longer than a yes/no confirm but still under Hermes' 300s httpx read timeout,
 * past which the MCP client has given up and waiting protects nothing.
 */
export const SECRET_REQUEST_TIMEOUT_MS = 180_000;

/**
 * Ask the human attached to `busKey` for a credential.
 *
 * Unlike `requestToolConfirmation` this deliberately does NOT honour
 * `MCP_CONFIRM_UNATTENDED=allow`. That escape hatch exists so an unattended
 * cron can still perform an approved action; there is no equivalent meaning
 * here, because with no browser attached there is nobody to type a secret and
 * "proceed anyway" would be nonsense. Unattended always reports back as such.
 */
export async function requestSecretFromUser(
  busKey: string,
  req: SecretRequest,
): Promise<SecretRequestOutcome> {
  const fn = busKey ? secretRequesters.get(busKey) : undefined;
  if (!fn) return { status: 'unattended' };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(req),
      new Promise<SecretRequestOutcome>((resolve) => {
        timer = setTimeout(() => resolve({ status: 'timeout' }), SECRET_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // A cancelled or reaped job rejects its waiters. Nothing was stored.
    return { status: 'declined' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Test helper — reset listener state between unit tests. */
export function _resetToolStepBusForTests(): void {
  listeners.clear();
  confirmers.clear();
  secretRequesters.clear();
}
