// Internal registry state — separated to avoid circular initialization with domain modules.
// Domain modules import `register` from here. The public API in registry.ts re-exports everything.

export interface AsyncOperationHandle {
  operationId: string;
  kind: string;
  status: string;
  statusTool: string;
  statusAction?: string;
  cancelTool?: string;
  cancelAction?: string;
  terminalStates: string[];
  resourceId?: string;
  environment: string;
}

export type ToolResult = { success: boolean; data?: unknown; error?: string };

/** Create the additive handle returned by tools that start background work. */
export function createAsyncOperationHandle(
  handle: AsyncOperationHandle,
): AsyncOperationHandle {
  return handle;
}

/**
 * Context passed to long-running tool handlers so they can emit user-visible
 * progress between major sub-steps. Optional — handlers that finish in <2s
 * can ignore it. The orchestrator wires `emit` to publish a `status` event
 * onto the active job's SSE stream.
 */
export interface ToolExecContext {
  emit: (text: string) => void;
  jobId?: string;
  conversationId?: string;
  /**
   * The tool-step bus key for this call — `workflow_id` on a canvas chat,
   * otherwise the chat id. Distinct from `conversationId`, which is always the
   * chat id: on a canvas chat the two differ, and the bus (SSE subscribers,
   * the destructive confirmer, the credential requester) is keyed by this one.
   * Set by the MCP dispatcher; absent for headless callers (heartbeat,
   * briefing, scheduled, selfimprove, workflow nodes), which is what makes a
   * human-in-the-loop tool correctly report "unattended" there.
   */
  busKey?: string;
}

/**
 * Declares that this tool kicks off a long-running asynchronous task. When
 * set, the chat layer auto-registers a perpetual heartbeat watcher on
 * success — the user gets periodic status updates plus a terminal summary
 * without the orchestrator having to remember anything.
 *
 * The `kind` must have a registered state-provider in
 * src/lib/heartbeat/state-providers.ts so the heartbeat engine can
 * pre-inject live task state into each tick.
 */
export interface ProducesLongRunningTask {
  kind: string;
  /** Dot-path inside the tool result data envelope (e.g. 'id', 'runId'). Read from result.data. */
  idPath: string;
  /** How often the heartbeat runs. Defaults to 30s. */
  cadenceSeconds?: number;
  /** Goal the LLM uses to decide when to reply DONE: …. */
  goal?: string;
  /** Per-tick prompt. Defaults to a generic "report status / mark DONE" instruction. */
  prompt?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  category: string;
  toolset: string;
  /**
   * Marks a tool whose call has a real, user-visible side effect that should
   * be confirmed before it runs (publishes public content, sends a message,
   * deploys to production, deletes/wipes data). This is the single source of
   * truth for destructive-action gating: `isDestructive()` reads it, and the
   * MCP layer surfaces it to Hermes as `annotations.destructiveHint` so the
   * live (Hermes) path can gate too. Omit for read-only / low-stakes tools.
   */
  destructive?: boolean;
  handler: (
    args: Record<string, unknown>,
    ctx?: ToolExecContext,
  ) => Promise<ToolResult>;
  producesLongRunningTask?: ProducesLongRunningTask;
}

export const tools: ToolDefinition[] = [];

export function register(tool: ToolDefinition) {
  tools.push(tool);
}

/**
 * Remove a tool from the in-memory registry by name. Returns true if a tool
 * was removed. Used when deleting custom tools so they disappear from the
 * active session without needing a process restart.
 */
export function unregister(name: string): boolean {
  const idx = tools.findIndex((t) => t.name === name);
  if (idx < 0) return false;
  tools.splice(idx, 1);
  return true;
}

export function getToolsByToolset(toolset: string): ToolDefinition[] {
  return tools.filter((t) => t.toolset === toolset);
}

export function getAvailableToolsets(): string[] {
  return [...new Set(tools.map((t) => t.toolset))];
}

export function isRegisteredTool(name: string): boolean {
  return tools.some((t) => t.name === name);
}
