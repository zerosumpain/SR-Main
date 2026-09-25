import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { executionContext } from '$lib/context/execution';
import { canonicalEventType, PLATFORM_EVENT_TYPES, type PlatformEventName, type PlatformEventType } from './catalogue';

/**
 * The platform event channel: publish, subscribe, and write it down.
 *
 * This used to live inside `$lib/workflows/event-bus`, alongside the code that
 * reacts to an event by starting a workflow. Publishing and dispatching are not
 * the same job, and joining them made the cheap half expensive: `event-bus`
 * imports `engine` from the `$lib/workflows` barrel, so anything that merely
 * wanted to SAY "a Strava activity synced" pulled in the entire node registry
 * behind it. Measured from `$lib/health`, that one edge took the module's import
 * closure from 308 files to 1,007. A publisher must not depend on its
 * subscribers, so the static imports here stay tiny.
 *
 * What an event is, and which exist, lives in `./catalogue` — the one list the
 * canvas picker, the phone and the dispatcher all read.
 *
 * Every emit is also written to `platform_events` (lazily, via `./store`), so
 * the bus has a history. The write is best-effort and never delays delivery.
 *
 * Loop safety travels WITH the event rather than in its payload:
 *  - `originWorkflowId` — the workflow whose run raised it, read from the
 *    ambient node execution context. A workflow is never started by an event
 *    its own run raised.
 *  - `chainDepth` — how many event→run hops led here. A run started by an event
 *    registers its depth (`setRunChainDepth`), so anything its nodes emit is one
 *    hop deeper, and the dispatcher stops at MAX_CHAIN_DEPTH.
 */

export { PLATFORM_EVENT_TYPES };
export type { PlatformEventType, PlatformEventName };

export interface PlatformEvent {
  /** Also the `platform_events` row id. */
  id?: string;
  type: PlatformEventType;
  payload?: Record<string, unknown>;
  source?: string | null;
  chainDepth?: number;
  originWorkflowId?: string | null;
  /** Resolves once the row write settles; true when it landed. */
  persisted?: Promise<boolean>;
}

export interface EmitOptions {
  source?: string;
  chainDepth?: number;
  originWorkflowId?: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

// ————————————————————————————— run chain depth

const runDepths = new Map<string, number>();
const MAX_TRACKED_RUNS = 5_000;

/** Called by the run start path for a run an event started. */
export function setRunChainDepth(runId: string, depth: number): void {
  if (depth <= 0) return;
  if (runDepths.size >= MAX_TRACKED_RUNS) runDepths.delete(runDepths.keys().next().value as string);
  runDepths.set(runId, depth);
}

export function runChainDepth(runId: string): number {
  return runDepths.get(runId) ?? 0;
}

export function clearRunChainDepth(runId: string): void {
  runDepths.delete(runId);
}

// ————————————————————————————— publish / subscribe

function persist(event: PlatformEvent & { id: string }): Promise<boolean> {
  return import('./store')
    .then(({ recordPlatformEvent }) =>
      recordPlatformEvent({
        id: event.id,
        type: event.type,
        payload: event.payload ?? {},
        source: event.source ?? null,
        chainDepth: event.chainDepth ?? 0,
        originWorkflowId: event.originWorkflowId ?? null,
      }),
    )
    .catch(() => false);
}

/** Publish an event. Never throws; returns what was delivered. */
export function emit(
  type: PlatformEventName,
  payload?: Record<string, unknown>,
  opts: EmitOptions = {},
): PlatformEvent & { id: string } {
  const ctx = executionContext.getStore();
  const legacyDepth = Number(payload?.chainDepth ?? 0);
  const event: PlatformEvent & { id: string } = {
    id: randomUUID(),
    type: canonicalEventType(type) as PlatformEventType,
    payload,
    source: opts.source ?? null,
    chainDepth: Math.max(
      opts.chainDepth ?? 0,
      ctx ? runChainDepth(ctx.runId) : 0,
      Number.isFinite(legacyDepth) ? legacyDepth : 0,
    ),
    originWorkflowId: opts.originWorkflowId ?? ctx?.workflowId ?? null,
  };
  event.persisted = persist(event);
  try {
    emitter.emit(event.type, event);
  } catch (err) {
    console.error(`[platform-bus] a ${event.type} listener threw:`, err instanceof Error ? err.message : err);
  }
  return event;
}

export function on(type: PlatformEventName, handler: (event: PlatformEvent) => void): () => void {
  const canonical = canonicalEventType(type);
  emitter.on(canonical, handler);
  return () => emitter.off(canonical, handler);
}

/** For the dispatcher, which subscribes to every catalogue type at boot. */
export function onAll(handler: (event: PlatformEvent) => void): () => void {
  const offs = PLATFORM_EVENT_TYPES.map((type) => on(type, handler));
  return () => offs.forEach((off) => off());
}
