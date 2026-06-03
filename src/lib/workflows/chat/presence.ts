// In-memory presence tracker for /jkai web sessions.
//
// The /jkai tab POSTs a heartbeat for the conversation it is actively viewing
// (see /api/workflows/orchestrator/chat/presence) every ~10s while the tab is
// visible. We record the last-seen timestamp per conversation so wa-escalation
// can tell whether the owner is genuinely watching before pinging WhatsApp.
//
// Why this exists instead of reusing getStreamSubscriberCount(): the SSE job
// stream closes ~10ms after a terminal `done`/`error` event, so by the time the
// escalation grace timer fires the subscriber count is always 0 — it cannot
// distinguish "navigated away" from "still watching, job just finished". A
// presence heartbeat is independent of the per-job SSE stream and survives the
// completion, so it answers "is a tab actively viewing this conversation?".

const lastSeen = new Map<string, number>();

// A conversation counts as "actively viewed" if we've had a heartbeat within
// this window. Must comfortably exceed the client heartbeat interval (10s) so a
// present user is never misjudged as away in the gap between two beats.
const PRESENCE_TTL_MS = 30_000;

// Drop entries this old on write so the map can't grow unbounded across many
// short-lived conversations. Well beyond any presence relevance.
const PRUNE_AFTER_MS = 10 * 60_000;

export function markPresent(conversationId: string): void {
  if (!conversationId) return;
  const now = Date.now();
  lastSeen.set(conversationId, now);
  // Opportunistic prune — cheap, and only meaningful once the map is non-trivial.
  if (lastSeen.size > 64) {
    for (const [id, ts] of lastSeen) {
      if (now - ts > PRUNE_AFTER_MS) lastSeen.delete(id);
    }
  }
}

export function isUserPresent(
  conversationId: string | null,
  ttlMs: number = PRESENCE_TTL_MS,
): boolean {
  if (!conversationId) return false;
  const ts = lastSeen.get(conversationId);
  if (ts == null) return false;
  return Date.now() - ts < ttlMs;
}
