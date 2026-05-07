// src/lib/curate/event-bus.ts
//
// In-memory pub/sub bridge between the curate engine and SSE clients.
// Engine calls pushEvent(); SSE GET handlers add/remove controllers.

export type CurateEventType = 'msg' | 'discovery' | 'phase' | 'test-result' | 'promote-step';

export interface CurateEvent {
  type: CurateEventType;
  [key: string]: unknown;
}

/** One enqueue-capable controller per active SSE connection. */
type SSEController = ReadableStreamDefaultController<Uint8Array>;

const subscribers = new Map<string, Set<SSEController>>();
const encoder = new TextEncoder();

/** Register an SSE controller for `sessionId`. Returns an unsubscribe function. */
export function subscribe(sessionId: string, controller: SSEController): () => void {
  let set = subscribers.get(sessionId);
  if (!set) {
    set = new Set();
    subscribers.set(sessionId, set);
  }
  set.add(controller);

  return () => {
    set!.delete(controller);
    if (set!.size === 0) {
      subscribers.delete(sessionId);
    }
  };
}

/**
 * Push a curate event to all SSE connections subscribed to `sessionId`.
 * Named SSE events are emitted with `event:` + `data:` so the browser
 * EventSource can filter by `type`.
 */
export function pushEvent(sessionId: string, event: CurateEvent): void {
  const set = subscribers.get(sessionId);
  if (!set || set.size === 0) return;

  const payload =
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  const bytes = encoder.encode(payload);

  for (const controller of set) {
    try {
      controller.enqueue(bytes);
    } catch {
      // Controller closed — remove it.
      set.delete(controller);
    }
  }

  if (set.size === 0) {
    subscribers.delete(sessionId);
  }
}
