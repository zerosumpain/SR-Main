// src/lib/workflowdoctor/engine.ts
//
// Boot seed only. The nightly schedule is the `daydream-doctor` heartbeat
// activity — see `$lib/heartbeat/activities/daydream-doctor.ts` for the window
// and the gates.
//
// ── What used to be here ────────────────────────────────────────────────────
//
// A private `croner` at 05:00 Europe/London with its own host gate, its own
// kill-switch read and its own idle gate, none of which anything else could
// see. Self-improvement gave up the identical arrangement on 2026-08-30; this
// one followed on 2026-09-04, so the site now has ONE scheduler. Nothing about
// the run changed: `runDoctorNow` is untouched, the advisory lock still holds
// the lane, and both switches mean what they meant.
//
// The seed stays host-agnostic and stays here, because `/jkai/daydreams/doctor` and the
// admin page need the two datastore collections to exist even on a host that
// never runs the doctor.

import { ensureDoctorCollections } from './findings';
import { errMsg } from './types';

let seeded = false;

/**
 * Ensure the doctor's two datastore collections exist. Idempotent, and safe to
 * call once from hooks.server.ts. Fire-and-forget; failures are logged.
 */
export function startWorkflowDoctor(): void {
  if (seeded) return;
  seeded = true;
  void ensureDoctorCollections().catch((err) =>
    console.error('[workflowdoctor] boot seed failed:', errMsg(err)),
  );
}

/** Kept so hooks.server.ts's shutdown path has something to call, and so a
 *  test can re-arm the seed. There is no longer a timer to stop. */
export function stopWorkflowDoctor(): void {
  seeded = false;
}
