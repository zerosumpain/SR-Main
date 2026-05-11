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
  stepId: string;          // unique per call, used to correlate started ↔ completed/failed
  phase: 'started' | 'completed' | 'failed';
  tool: string;
  args?: Record<string, unknown>;
  resultPreview?: string;   // truncated for UI display
  result?: unknown;         // full result (the subscriber decides what to surface)
  error?: string;
  summary?: string;         // short human-readable summary (parity with legacy emitter)
  ts: number;
}

type Listener = (e: ToolStepEvent) => void;

const listeners = new Map<string, Set<Listener>>();

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

/** Test helper — reset listener state between unit tests. */
export function _resetToolStepBusForTests(): void {
  listeners.clear();
}
