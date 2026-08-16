// Follow-ups typed while a reply was still streaming, held until the turn closes
// — and kept across a reload.
//
// Keyed by conversation, because a queued follow-up belongs to a thread: the chat
// mounts one pane per open tab, each with its own queue, and reloading restores
// all of them. Storage lives here rather than in ChatArea so there is one copy of
// the read/write/prune logic no matter how many panes are mounted.
//
// Same shape and the same freshness window as `open-tabs.svelte`: a queue is a
// statement of intent about what to send NEXT, and after a couple of hours that
// intent is stale. Firing yesterday's half-thought at the model on a morning page
// load would be worse than losing it.

const STORAGE_KEY = 'jkai.queuedSends';
const RESTORE_WINDOW_MS = 2 * 60 * 60 * 1000;

interface StoredQueues {
  savedAt?: unknown;
  byConversation?: unknown;
}

export const queued = $state({
  byConversation: {} as Record<string, string[]>,
});

let hydrated = false;

function persist(): void {
  try {
    // Drop emptied threads on the way out, or the entry grows a row per
    // conversation ever queued in and never shrinks.
    const byConversation: Record<string, string[]> = {};
    for (const [id, texts] of Object.entries(queued.byConversation)) {
      if (texts.length > 0) byConversation[id] = texts;
    }
    if (Object.keys(byConversation).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), byConversation }));
  } catch {
    // Private mode / quota. The queue still works, it just won't survive a reload.
  }
}

/**
 * Restore the saved queues. Idempotent, so every pane can call it on mount
 * without the second one wiping the first one's work.
 */
export function hydrateQueuedSends(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredQueues;
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (Date.now() - savedAt > RESTORE_WINDOW_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const src = parsed.byConversation;
    if (!src || typeof src !== 'object') return;
    const restored: Record<string, string[]> = {};
    for (const [id, texts] of Object.entries(src as Record<string, unknown>)) {
      if (!Array.isArray(texts)) continue;
      const clean = texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
      if (clean.length > 0) restored[id] = clean;
    }
    queued.byConversation = restored;
  } catch {
    // Corrupt entry — start clean rather than throw on page load.
  }
}

/** This thread's pending follow-ups, oldest first. */
export function queuedFor(conversationId: string | null): string[] {
  if (!conversationId) return [];
  return queued.byConversation[conversationId] ?? [];
}

export function pushQueued(conversationId: string, text: string): void {
  const current = queued.byConversation[conversationId] ?? [];
  queued.byConversation = {
    ...queued.byConversation,
    [conversationId]: [...current, text],
  };
  persist();
}

/**
 * Remove and return the oldest follow-up — FIFO, so they are answered in the
 * order they were typed.
 *
 * Removed BEFORE it is sent, deliberately: a send that fails leaves its text in
 * the transcript as an error rather than back in the queue, so a reload cannot
 * replay it forever.
 */
export function takeQueued(conversationId: string): string | null {
  const current = queued.byConversation[conversationId] ?? [];
  if (current.length === 0) return null;
  const [next, ...rest] = current;
  const nextMap = { ...queued.byConversation };
  if (rest.length > 0) nextMap[conversationId] = rest;
  else delete nextMap[conversationId];
  queued.byConversation = nextMap;
  persist();
  return next;
}

export function dropQueued(conversationId: string, index: number): void {
  const current = queued.byConversation[conversationId] ?? [];
  const rest = current.filter((_, i) => i !== index);
  const nextMap = { ...queued.byConversation };
  if (rest.length > 0) nextMap[conversationId] = rest;
  else delete nextMap[conversationId];
  queued.byConversation = nextMap;
  persist();
}

/** Forget a thread's queue — used when the conversation itself is deleted. */
export function forgetQueued(conversationId: string): void {
  if (!(conversationId in queued.byConversation)) return;
  const nextMap = { ...queued.byConversation };
  delete nextMap[conversationId];
  queued.byConversation = nextMap;
  persist();
}
