// src/lib/daydream/types.ts
//
// Shared constants and types for daydreaming — the background state in which
// jkai looks at what it already knows and asks whether anything is worth
// saying.
//
// The location half (trail, places, movement mode, coverage, retention) moved
// to $lib/home/presence/types on 2026-09-26 so /home/people survives the
// daydream simplification. Only the generic helpers daydream code still uses
// are re-exported; presence code imports $lib/home/presence/types directly.

export { DEFAULT_SUBJECT, LOCAL_TZ, errMsg, localDayStart } from '$lib/home/presence/types';

// ── Settings keys (app_settings) ─────────────────────────────────────────────

/** Master kill switch. Unset/null is treated as ENABLED, matching the
 *  self-improvement engine's convention. */
export const SETTINGS_ENABLED_KEY = 'daydream.enabled';
/** Per-kind mute list, written by a `never_kind` tap. */
export const SETTINGS_MUTED_KINDS_KEY = 'daydream.muted_kinds';
