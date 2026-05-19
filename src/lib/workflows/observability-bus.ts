import { EventEmitter } from 'node:events';

/**
 * Observability event bus.
 *
 * Distinct from `./event-bus.ts`, which carries cross-workflow trigger
 * events ('strava_activity_synced' etc.) and dispatches matching event-
 * triggered schedules. Keeping the two emitters separate avoids a node
 * completion accidentally triggering an unrelated workflow.
 *
 * Listeners: one per open SSE connection plus any future internal
 * subscribers (e.g., a downstream metrics pipeline). The 200-listener cap
 * is generous — a 50-node workflow with 10 open canvas tabs is ~10
 * subscribers — but high enough to avoid spurious MaxListenersExceeded
 * warnings if many tabs are open against many canvases.
 */

export interface RunStarted {
  workflowId: string;
  runId: string;
  trigger: string;
  startedAt: string;
}

export interface RunCompleted {
  workflowId: string;
  runId: string;
  status: 'completed' | 'completed_with_errors' | 'awaiting_human';
  completedAt: string;
  durationMs: number | null;
}

export interface RunFailed {
  workflowId: string;
  runId: string;
  error: string;
  completedAt: string;
}

export interface NodeStarted {
  workflowId: string;
  runId: string;
  nodeId: string;
  startedAt: string;
}

export interface NodeCompleted {
  workflowId: string;
  runId: string;
  nodeId: string;
  completedAt: string;
  durationMs: number;
  /** Sum across all LLM calls inside this node. null = no usage captured
   *  (non-LLM node, or unknown-priced model). */
  costUsd: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
}

export interface NodeFailed {
  workflowId: string;
  runId: string;
  nodeId: string;
  completedAt: string;
  error: string;
}

export interface AuditEdit {
  workflowId: string;
  entity: string;
  action: string;
  at: string;
}

export interface ObservabilityEvents {
  'run.started': RunStarted;
  'run.completed': RunCompleted;
  'run.failed': RunFailed;
  'node.started': NodeStarted;
  'node.completed': NodeCompleted;
  'node.failed': NodeFailed;
  'audit.edit': AuditEdit;
}

export type ObservabilityEventType = keyof ObservabilityEvents;

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function emitObs<T extends ObservabilityEventType>(
  type: T,
  payload: ObservabilityEvents[T],
): void {
  // EventEmitter.emit calls listeners synchronously and rethrows if any
  // listener throws. Telemetry must never crash the producer: an SSE
  // writer that has lost its socket should not bring down a workflow
  // run. Catch + log + continue.
  try {
    emitter.emit(type, payload);
  } catch (err) {
    console.error(`[observability-bus] listener threw for "${type}":`, err);
  }
}

export function onObs<T extends ObservabilityEventType>(
  type: T,
  handler: (event: ObservabilityEvents[T]) => void,
): () => void {
  emitter.on(type, handler);
  return () => emitter.off(type, handler);
}

/** Subscribe to every event type; the handler receives the type plus the
 *  typed payload. Used by SSE handlers that fan all events out to clients. */
export function onAllObs(
  handler: <T extends ObservabilityEventType>(type: T, event: ObservabilityEvents[T]) => void,
): () => void {
  const types: ObservabilityEventType[] = [
    'run.started',
    'run.completed',
    'run.failed',
    'node.started',
    'node.completed',
    'node.failed',
    'audit.edit',
  ];
  const offs = types.map((t) =>
    onObs(t, (event) =>
      // The bus is monomorphic per channel; the cast preserves the per-type
      // payload shape for the handler.
      (handler as (type: ObservabilityEventType, ev: unknown) => void)(t, event),
    ),
  );
  return () => offs.forEach((off) => off());
}
