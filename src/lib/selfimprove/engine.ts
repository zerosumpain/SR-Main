// src/lib/selfimprove/engine.ts
//
// Boot-time seeding for the self-improvement engine.
//
// ── What used to be here ────────────────────────────────────────────────────
//
// This file also owned a private `croner` job at 03:30 Europe/London, with its
// own host gate, its own kill-switch read and its own idle gate. That made the
// site run two idle-cycle schedulers side by side, and the second one had no
// advantage left over the first: the heartbeat gives an activity per-row
// cadence, an active-hours window that reschedules to the next opening instead
// of locking out, quota attribution on every pulse, a failure budget and a
// dashboard that already lists twenty-odd other jobs.
//
// The schedule now lives in `$lib/heartbeat/activities/daydream-improve.ts`,
// which carries every one of those gates across unchanged. Nothing about the
// RUN moved: `runImprovementNow` still writes one `improvement_runs` record a
// night and both ledgers still read it.
//
// Seeding stays here because it is host-agnostic and must happen on every boot
// — dev included — so the system collections and the API catalogue exist before
// anything asks for them.

import { runSeeds } from './seed-apis';
import { errMsg } from './types';

let seeded = false;

/**
 * Seed the system collections + API catalogue. Idempotent and safe to call
 * once from hooks.server.ts; failures are logged and never thrown, because a
 * seed problem must not stop the server booting.
 */
export function startSelfImprovementSeeds(): void {
  if (seeded) return;
  seeded = true;

  void runSeeds()
    .then((r) => {
      if (r.seeded > 0) console.log(`[selfimprove] seeded ${r.seeded} API(s), ${r.skipped} already present`);
    })
    .catch((err) => console.error('[selfimprove] boot seed failed:', errMsg(err)));
}

/** Test hook — lets a suite re-arm the once-only guard. */
export function resetSelfImprovementSeeds(): void {
  seeded = false;
}
