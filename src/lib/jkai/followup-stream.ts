// One browser SSE connection to /api/jkai/events for every chat thread the page
// currently has open.
//
// Each open tab mounts its own ChatArea, and each needs the follow-up feed for
// its thread — status updates during a turn, heartbeat notes, Gmail previews,
// intel-extraction phase changes. A connection per pane would spend the
// six-per-origin HTTP/1.1 budget the dev server runs under before the job
// streams got a look in, and the streams over the line stall silently.
//
// Reconnect policy: we reopen only when a thread needs adding that the live
// connection does not already carry. Closing a tab does NOT reconnect — the
// stale subscription costs nothing (its handler is gone, so its frames are
// dropped here) and reopening would risk a gap for the threads still running.
// Opening a tab does reopen, and any frame that lands in that few-millisecond
// window is lost; that only ever costs a status line, because the reply itself
// arrives on the job stream, which this module does not touch.

type Handler = (data: Record<string, unknown>) => void;

const handlers = new Map<string, Set<Handler>>();

let es: EventSource | null = null;
/** Threads the live connection is subscribed to — a superset of `handlers`. */
let connected = new Set<string>();
let syncQueued = false;

function activeIds(): string[] {
  const ids: string[] = [];
  for (const [id, set] of handlers) if (set.size > 0) ids.push(id);
  return ids;
}

function open(ids: string[]): void {
  es?.close();
  connected = new Set(ids);
  if (ids.length === 0) {
    es = null;
    return;
  }
  const next = new EventSource(
    `/api/jkai/events?conversationIds=${encodeURIComponent(ids.join(','))}`,
  );
  es = next;
  next.onmessage = (event: MessageEvent) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === 'connected') return;
    const convId = typeof data.conversationId === 'string' ? data.conversationId : null;
    if (!convId) return;
    const set = handlers.get(convId);
    if (!set) return;
    for (const fn of set) fn(data);
  };
  next.onerror = () => {
    // EventSource auto-reconnects with the same URL; nothing to do.
  };
}

/** Coalesce the opens that several panes mounting in the same frame would cause. */
function sync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    const wanted = activeIds();
    if (wanted.length === 0) {
      if (es) open([]);
      return;
    }
    // Already covered? Leave the connection alone.
    if (es && wanted.every((id) => connected.has(id))) return;
    open([...new Set([...connected, ...wanted])].filter((id) => handlers.has(id)));
  });
}

/**
 * Receive follow-up frames for one conversation. Returns an unsubscribe.
 *
 * Handlers are per-conversation rather than per-component so two panes on the
 * same thread (a tab plus a deep link, say) both see it.
 */
export function subscribeFollowups(conversationId: string, handler: Handler): () => void {
  let set = handlers.get(conversationId);
  if (!set) {
    set = new Set();
    handlers.set(conversationId, set);
  }
  set.add(handler);
  sync();
  return () => {
    const current = handlers.get(conversationId);
    if (!current) return;
    current.delete(handler);
    if (current.size === 0) handlers.delete(conversationId);
    sync();
  };
}
