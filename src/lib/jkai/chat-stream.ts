export interface ChatStreamCallbacks {
  /** Fires for every parsed SSE message. */
  onEvent: (data: unknown) => void;
  /** Reconnect / gap warnings. Empty string is never used; null clears. */
  onWarning: (warning: string | null) => void;
}

export interface ChatStreamHandle {
  /** Close the connection and resolve `done`. Idempotent. */
  close: () => void;
  /** Resolves when the server sends `done` or `error`, or when `close()` is called. */
  done: Promise<void>;
}

const SSE_GAP_LIMIT_MS = 12_000;
const SSE_CHECK_INTERVAL_MS = 3_000;
const MAX_RECONNECTS = 5;

/**
 * Open an SSE connection to /api/workflows/orchestrator/chat/stream and
 * dispatch parsed events to `cb.onEvent`. Watches for stale connections
 * (no event of any kind for SSE_GAP_LIMIT_MS, including 5s heartbeats) and
 * reconnects up to MAX_RECONNECTS times before giving up.
 *
 * Reconnects RESUME rather than replay: the server tags every frame with a
 * sequence number, the browser hands it back as `Last-Event-ID` on its own
 * auto-reconnect, and the manual reopen below passes the same number as
 * `?after=`. Consumers append deltas, so a replay would silently double the
 * bubble.
 */
export function streamChatJob(jobId: string, cb: ChatStreamCallbacks): ChatStreamHandle {
  let es: EventSource | null = null;
  let lastSseEventAt = Date.now();
  let lastEventId: string | null = null;
  let reconnectAttempts = 0;
  let finished = false;

  let resolveDone!: () => void;
  const done = new Promise<void>((r) => { resolveDone = r; });

  const finalize = () => {
    if (finished) return;
    finished = true;
    if (es) { es.close(); es = null; }
    clearInterval(gapTimer);
    cb.onWarning(null);
    resolveDone();
  };

  const openStream = () => {
    const after = lastEventId !== null ? `&after=${encodeURIComponent(lastEventId)}` : '';
    const next = new EventSource(`/api/workflows/orchestrator/chat/stream?jobId=${jobId}${after}`);
    es = next;
    lastSseEventAt = Date.now();
    next.onmessage = (event: MessageEvent) => {
      lastSseEventAt = Date.now();
      if (event.lastEventId) lastEventId = event.lastEventId;
      cb.onWarning(null);
      let data: unknown;
      try { data = JSON.parse(event.data); } catch { return; }
      cb.onEvent(data);
      const t = (data as { type?: string } | null)?.type;
      if (t === 'done' || t === 'error') finalize();
    };
    next.onerror = () => {
      // Browser auto-reconnects; surface a quiet warning.
      if (!finished) cb.onWarning('Reconnecting…');
    };
  };

  const gapTimer = setInterval(() => {
    if (finished) return;
    const gap = Date.now() - lastSseEventAt;
    if (gap <= SSE_GAP_LIMIT_MS) return;

    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECTS) {
      cb.onWarning('Lost connection to orchestrator. The job may still be running — try refreshing.');
      return;
    }
    cb.onWarning(`No update for ${Math.round(gap / 1000)}s — reconnecting…`);
    console.warn(`[chat] SSE gap ${gap}ms (attempt ${reconnectAttempts}/${MAX_RECONNECTS}) — reconnecting`);
    if (es) { es.close(); es = null; }
    openStream();
  }, SSE_CHECK_INTERVAL_MS);

  openStream();

  return {
    close: () => finalize(),
    done,
  };
}
