import { db } from '$lib/db';
import { jkaiLogs } from '$lib/db/schema';
import { EventEmitter } from 'events';

// --- Event Emitter for SSE ---

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function onBuildLog(
  buildId: string,
  handler: (log: { id: number; type: string; content: string; iterationId: string | null }) => void,
): () => void {
  const key = `log:${buildId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}

// Strip null bytes and other control chars that break Postgres text columns
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export async function emitLog(
  buildId: string,
  type: string,
  content: string,
  iterationId: string | null = null,
): Promise<void> {
  const safeContent = sanitize(content);
  const [log] = await db
    .insert(jkaiLogs)
    .values({ buildId, iterationId, type, content: safeContent })
    .returning();
  emitter.emit(`log:${buildId}`, {
    id: log.id,
    type: log.type,
    content: log.content,
    iterationId: log.iterationId,
  });
}

// --- Live (non-persisted) stream ---
//
// onBuildLive subscribes to transient streaming events that are NOT written
// to the jkai_logs table — e.g. token-level deltas from the pi agent. The
// SSE handler fans these out to connected clients with negative IDs so they
// never collide with persisted log IDs and are not replayed on reconnect.

export interface LiveEvent {
  type:
    | 'stream_text'
    | 'stream_thinking'
    | 'stream_tool_start'
    | 'stream_tool_delta'
    | 'stream_tool_end'
    | 'stream_turn_end'
    | 'plan_proposed'
    // Phase 5/6/7 session events — flow through the same SSE stream so
    // BuildSessionPanel can render them without a separate WebSocket.
    // Cloudflare's HTTP/2 layer doesn't proxy WS upgrades; SSE works fine.
    | 'session_pending'   // queue snapshot after add/remove
    | 'session_notes'     // notes snapshot after add/remove
    | 'session_shell_start'
    | 'session_shell_chunk'
    | 'session_shell_end'
    | 'session_interrupted';
  iterationId: string | null;
  streamId: string; // stable within one streaming segment
  delta?: string;   // incremental content for text / thinking / tool-delta
  full?: string;    // full snapshot at end of segment (plan body for plan_proposed)
  toolName?: string; // tool_start / tool_end
  // Session-event payloads — typed as `unknown` since each variant carries
  // different data; the panel narrows on `event.type`.
  payload?: unknown;
}

export function onBuildLive(
  buildId: string,
  handler: (event: LiveEvent) => void,
): () => void {
  const key = `live:${buildId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}

export function emitLive(buildId: string, event: LiveEvent): void {
  emitter.emit(`live:${buildId}`, event);
}
