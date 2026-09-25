// src/lib/daydream/types.ts
//
// Shared constants for daydreaming — the background state in which jkai looks
// at what it already knows and asks whether anything is worth saying. Kept
// free of `$lib/db` so pure modules can be unit-tested without a database.
//
// P4a (2026-09-25) removed the trail, place, movement and coverage constants
// with the engine that used them.

/** Whose notes. One owner today; `subject` on a note keeps it per-person ready
 *  (spec 2026-09-25, D4). */
export const DEFAULT_SUBJECT = 'john';

/** Local timezone for day boundaries. A rhythm is a LOCAL fact — "usually
 *  Tuesday afternoon" is meaningless in UTC. */
export const LOCAL_TZ = 'Europe/London';

// ── Settings keys (app_settings) ─────────────────────────────────────────────

/** Master kill switch. Unset/null is treated as ENABLED, matching the
 *  self-improvement engine's convention. */
export const SETTINGS_ENABLED_KEY = 'daydream.enabled';
/** Per-kind mute list, written by a `never_kind` tap. */
export const SETTINGS_MUTED_KINDS_KEY = 'daydream.muted_kinds';

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
