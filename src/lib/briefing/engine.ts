// Briefing scheduler. Mirrors the self-improvement engine: seed the collection
// on boot (host-agnostic), schedule the daily cron only in production
// (hostname !== 'homeserv', unless BRIEFING_ALLOW_DEV=1), and re-check the kill
// switch in the cron callback. Never throws into croner.
import { Cron } from 'croner';
import os from 'os';
import { getSetting } from '$lib/server/models/settings';
import { runBriefingNow, ensureBriefingsCollection } from './run';
import { CRON_EXPR, CRON_TZ, SETTINGS_ENABLED_KEY, errMsg } from './types';

let cronJob: Cron | null = null;
let started = false;

export function isBriefingScheduled(): boolean {
  return cronJob !== null;
}

export function startBriefingEngine(): void {
  if (started) return;
  started = true;

  // Ensure the collection exists everywhere (dev + prod).
  void ensureBriefingsCollection().catch((err) => console.error('[briefing] ensure collection failed:', errMsg(err)));

  // The briefing is produced by the `canvas:morning-briefing` workflow, which
  // gathers the signals, verifies them and sends the WhatsApp summary. This
  // engine's own cron would be a second, competing producer writing into the
  // same collection, so it stays off unless explicitly asked for (2026-07-29).
  if (process.env.BRIEFING_ALLOW_DEV !== '1') {
    console.log('[briefing] cron disabled — canvas:morning-briefing owns the schedule. Set BRIEFING_ALLOW_DEV=1 to override.');
    return;
  }

  const host = os.hostname();
  if (host === 'homeserv' && process.env.BRIEFING_ALLOW_DEV !== '1') {
    console.log('[briefing] host is homeserv — daily cron disabled. Set BRIEFING_ALLOW_DEV=1 to enable locally.');
    return;
  }

  try {
    cronJob = new Cron(CRON_EXPR, { timezone: CRON_TZ }, () => {
      void fireCron();
    });
    console.log(`[briefing] daily briefing scheduled (${CRON_EXPR} ${CRON_TZ})`);
  } catch (err) {
    console.error('[briefing] failed to schedule cron:', errMsg(err));
  }
}

async function fireCron(): Promise<void> {
  try {
    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      console.log('[briefing] kill switch is off — skipping daily briefing');
      return;
    }
    await runBriefingNow({ trigger: 'cron' });
  } catch (err) {
    console.error('[briefing] cron fire skipped/failed:', errMsg(err));
  }
}

export function stopBriefingEngine(): void {
  if (cronJob) cronJob.stop();
  cronJob = null;
  started = false;
}
