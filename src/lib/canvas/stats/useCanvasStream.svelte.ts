/**
 * Live canvas observability stream.
 *
 * Wraps `/api/canvas/[slug]/stream` (SSE) into Svelte 5 reactive state.
 * Returns a snapshot taken at connect time plus a `lastEvent` that bumps
 * every time a typed observability event arrives. Other components derive
 * their own "should I refetch?" signals from `lastEvent`, keeping each
 * node's subscription criteria local to that node.
 *
 * Only one connection per slug per tab — re-mounting the hook with the
 * same slug() reuses the EventSource? No: a fresh hook instance opens a
 * fresh EventSource. The canvas page should instantiate ONE hook at the
 * top level and pass `lastEvent` down to interested children rather than
 * letting each child open its own connection.
 */

export type ObservabilityEventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'node.started'
  | 'node.completed'
  | 'node.failed'
  | 'audit.edit';

export interface CanvasSnapshot {
  activeRuns: Array<{ runId: string; startedAt: string | null; trigger: string }>;
  recentRuns: Array<{
    runId: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  lastEditAt: string | null;
}

export interface LiveEvent {
  type: ObservabilityEventType;
  data: Record<string, unknown>;
  at: number;
  /** Monotonically-increasing sequence so derived signals can re-fire even
   *  if two events of the same type land in the same tick. */
  seq: number;
}

const ALL_TYPES: ObservabilityEventType[] = [
  'run.started',
  'run.completed',
  'run.failed',
  'node.started',
  'node.completed',
  'node.failed',
  'audit.edit',
];

export function useCanvasStream(slug: () => string) {
  let snapshot = $state<CanvasSnapshot | null>(null);
  let lastEvent = $state<LiveEvent | null>(null);
  let connected = $state(false);
  let seq = 0;

  $effect(() => {
    const s = slug();
    if (!s) return;

    // SSR / non-browser guard — `EventSource` only exists in the browser.
    if (typeof EventSource === 'undefined') return;

    const es = new EventSource(`/api/canvas/${encodeURIComponent(s)}/stream`);

    es.addEventListener('open', () => {
      connected = true;
    });
    es.addEventListener('error', () => {
      // EventSource auto-reconnects with exponential backoff; we surface
      // connected=false until 'open' fires again so any future UI can
      // show a "reconnecting" indicator without us writing reconnect logic.
      connected = false;
    });

    es.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        snapshot = JSON.parse(e.data) as CanvasSnapshot;
      } catch {
        // Malformed payload — leave snapshot null, the page falls back to
        // REST endpoints which still work.
      }
    });

    const handlers: Array<{ type: ObservabilityEventType; fn: (e: MessageEvent) => void }> = [];
    for (const type of ALL_TYPES) {
      const fn = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>;
          seq += 1;
          lastEvent = { type, data, at: Date.now(), seq };
        } catch {
          /* malformed event — skip */
        }
      };
      handlers.push({ type, fn });
      es.addEventListener(type, fn);
    }

    return () => {
      for (const h of handlers) es.removeEventListener(h.type, h.fn);
      es.close();
    };
  });

  return {
    get snapshot() {
      return snapshot;
    },
    get lastEvent() {
      return lastEvent;
    },
    get connected() {
      return connected;
    },
  };
}
