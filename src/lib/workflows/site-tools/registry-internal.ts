// Internal registry state — separated to avoid circular initialization with domain modules.
// Domain modules import `register` from here. The public API in registry.ts re-exports everything.

export type ToolResult = { success: boolean; data?: unknown; error?: string };

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
   * The canvas this chat is scoped to, or null/absent on an unscoped chat (the
   * /jkai hub, WhatsApp, a sub-agent, the follow-up queue). Set by the chat
   * loop, which already knows — it is the same value the canvas page posts.
   *
   * This field exists because the answer used to be GUESSED from the shape of
   * `conversationId`: Hermes gave the general hub a synthetic non-UUID chat id
   * and a canvas chat a chat_id equal to the workflow id, so "UUID-shaped means
   * canvas" held. Hermes was removed on 2026-08-24 and every chat now passes a
   * real `jkai_conversations.id` — `gen_random_uuid()::text` — so the guess was
   * true for EVERY chat, and workflow_build_from_spec refused to create a
   * canvas anywhere, telling the owner his chat was pinned to a workflow that
   * did not exist. Ask, do not infer.
   */
  workflowId?: string | null;
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
  /**
   * The model the owner pinned for this chat session, or absent when the thread
   * runs on a stamped site default.
   *
   * Tools that only make an LLM call do not need this — `currentSessionModel()`
   * in `$lib/context/chat` reaches them through the turn's AsyncLocalStorage.
   * It is here for the tools whose work OUTLIVES the turn: a build, a studio
   * build, a change request are all started and then abandoned by the chat that
   * asked for them, and run later in a sidecar with no ambient context at all.
   * Those have to write the model onto their row, and this is where they read
   * it from.
   */
  modelContext?: import('$lib/server/models/types').ModelContext;
  /** The session's reasoning effort, carried for the same reason. */
  thinkingLevel?: import('$lib/models/thinking').ThinkingLevel | null;
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
   * MCP layer surfaces it as `annotations.destructiveHint` so an external
   * client can gate too. Omit for read-only / low-stakes tools.
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
