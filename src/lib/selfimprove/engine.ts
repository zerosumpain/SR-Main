// src/lib/selfimprove/engine.ts
//
// The self-improvement scheduler. On boot it ALWAYS seeds the system
// collections + API catalogue (host-agnostic), then — only in production
// (hostname !== 'homeserv', unless SELF_IMPROVE_ALLOW_DEV=1) — schedules the
// nightly run at 03:30 Europe/London. The cron callback re-checks the kill
// switch and the idle gate before delegating to `runImprovementNow`, and never
// throws into croner.

import { Cron } from 'croner';
import os from 'os';
import { getSetting } from '$lib/server/models/settings';
import { runSeeds } from './seed-apis';
import { runImprovementNow, isUserActive } from './run';
import { CRON_EXPR, CRON_TZ, SETTINGS_ENABLED_KEY, errMsg } from './types';

let cronJob: Cron | null = null;
let started = false;

/** Read-only accessor for diagnostics/tests. */
export function isScheduled(): boolean {
  return cronJob !== null;
}

/**
 * Seed on every boot; schedule the nightly cron only in production. Idempotent
 * — safe to call once from hooks.server.ts.
 */
export function startSelfImprovement(): void {
  if (started) return;
  started = true;

  // Seeds are host-agnostic (dev + prod). Fire-and-forget; failures logged.
  void runSeeds()
    .then((r) => {
      if (r.seeded > 0) console.log(`[selfimprove] seeded ${r.seeded} API(s), ${r.skipped} already present`);
    })
    .catch((err) => console.error('[selfimprove] boot seed failed:', errMsg(err)));

  // Prod-only cron gate (inverse of the scraper's homeserv-only gate).
  const host = os.hostname();
  if (host === 'homeserv' && process.env.SELF_IMPROVE_ALLOW_DEV !== '1') {
    console.log(
      '[selfimprove] host is homeserv — nightly cron disabled (seeds still ran). Set SELF_IMPROVE_ALLOW_DEV=1 to enable locally.',
    );
    return;
  }

  try {
    cronJob = new Cron(CRON_EXPR, { timezone: CRON_TZ }, () => {
      void fireCron();
    });
    console.log(`[selfimprove] nightly self-improvement scheduled (${CRON_EXPR} ${CRON_TZ})`);
  } catch (err) {
    console.error('[selfimprove] failed to schedule cron:', errMsg(err));
  }
}

/** Cron callback — kill switch + idle gate, then run. Never throws. */
async function fireCron(): Promise<void> {
  try {
    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      console.log('[selfimprove] kill switch is off — skipping nightly run');
      return;
    }
    if (await isUserActive()) {
      console.log('[selfimprove] user active in the last hour — skipping nightly run');
      return;
    }
    await runImprovementNow({ trigger: 'cron' });
  } catch (err) {
    // The overlap guard throws if a run is already in progress — expected; log.
    console.error('[selfimprove] cron fire skipped/failed:', errMsg(err));
  }
}

export function stopSelfImprovement(): void {
  if (cronJob) cronJob.stop();
  cronJob = null;
  started = false;
}
