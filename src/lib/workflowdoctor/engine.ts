// src/lib/workflowdoctor/engine.ts
//
// The workflow-doctor scheduler. On boot it ALWAYS seeds the two system
// collections (host-agnostic), then — only in production (hostname !==
// 'homeserv', unless WORKFLOW_DOCTOR_ALLOW_DEV=1) — schedules the nightly run at
// 05:00 Europe/London. The cron callback re-checks the kill switch and the idle
// gate before delegating to `runDoctorNow`, and never throws into croner.
//
// Structurally identical to $lib/selfimprove/engine on purpose: two nightly
// engines that arm, gate and log the same way are two engines one person can
// still reason about at 05:00.

import { Cron } from 'croner';
import os from 'os';
import { getSetting } from '$lib/server/models/settings';
import { isUserActive } from '$lib/selfimprove/run';
import { ensureDoctorCollections } from './findings';
import { runDoctorNow } from './run';
import { CRON_EXPR, CRON_TZ, IDLE_WINDOW_MS, SETTINGS_ENABLED_KEY, errMsg } from './types';

let cronJob: Cron | null = null;
let started = false;

/** Read-only accessor for diagnostics/tests. */
export function isDoctorScheduled(): boolean {
  return cronJob !== null;
}

/**
 * Seed on every boot; schedule the nightly cron only in production. Idempotent
 * — safe to call once from hooks.server.ts.
 */
export function startWorkflowDoctor(): void {
  if (started) return;
  started = true;

  // Before the host gate and deliberately so: homeserv never arms the cron but
  // still needs the collections to exist for local work on /jkai/doctor.
  // Fire-and-forget; failures logged.
  void ensureDoctorCollections().catch((err) =>
    console.error('[workflowdoctor] boot seed failed:', errMsg(err)),
  );

  // Prod-only cron gate (inverse of the scraper's homeserv-only gate).
  const host = os.hostname();
  if (host === 'homeserv' && process.env.WORKFLOW_DOCTOR_ALLOW_DEV !== '1') {
    console.log(
      '[workflowdoctor] host is homeserv — nightly cron disabled (collections still seeded). Set WORKFLOW_DOCTOR_ALLOW_DEV=1 to enable locally.',
    );
    return;
  }

  try {
    cronJob = new Cron(CRON_EXPR, { timezone: CRON_TZ }, () => {
      void fireCron();
    });
    console.log(`[workflowdoctor] nightly workflow doctor scheduled (${CRON_EXPR} ${CRON_TZ})`);
  } catch (err) {
    console.error('[workflowdoctor] failed to schedule cron:', errMsg(err));
  }
}

/** Cron callback — kill switch + idle gate, then run. Never throws. */
async function fireCron(): Promise<void> {
  try {
    // House semantics: unset/null is ENABLED, only an explicit false disables.
    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      console.log('[workflowdoctor] kill switch is off — skipping nightly run');
      return;
    }
    if (await isUserActive(IDLE_WINDOW_MS)) {
      console.log('[workflowdoctor] user active in the last hour — skipping nightly run');
      return;
    }
    await runDoctorNow({ trigger: 'cron' });
  } catch (err) {
    // The overlap guard throws if a run is already in progress — expected; log.
    console.error('[workflowdoctor] cron fire skipped/failed:', errMsg(err));
  }
}

export function stopWorkflowDoctor(): void {
  if (cronJob) cronJob.stop();
  cronJob = null;
  started = false;
}
