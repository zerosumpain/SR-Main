// Model-routing boot hook and nightly selection.
//
// The nightly selection runs on the heartbeat since 2026-10-02 (the
// `model-routing` activity, 04:00–04:55 Europe/London), not on its own croner:
// one scheduler for the site's idle-cycle work, with pulses and a pause
// switch. What stays here is what boot needs on every host — the collections
// and the discovered Codex models' reasoning ceilings — and the run itself,
// with the kill switch it always re-checked at fire time.
import os from 'os';
import { getSetting } from '$lib/server/models/settings';
import { runSelectionNow } from './run';
import { ensureRoutingCollections } from './events';
import { loadDiscoveredCodexModels } from '$lib/server/models/codex-discovery';
import { SETTINGS_ENABLED_KEY, errMsg } from './types';

let started = false;

/** Boot only. Idempotent; called from hooks.server.ts. */
export function startModelRouting(): void {
  if (started) return;
  started = true;
  void ensureRoutingCollections().catch((err) =>
    console.error('[routing] ensure collections failed:', errMsg(err)),
  );
  // Registers discovered Codex models' reasoning ceilings before the first chat
  // turn, so a request clamps to what the model took rather than to `xhigh`.
  void loadDiscoveredCodexModels();
}

export function stopModelRouting(): void {
  started = false;
}

/**
 * The nightly selection, as the heartbeat runs it. Production only — homeserv
 * shares a dev database (`ROUTING_ALLOW_DEV=1` overrides) — and only while the
 * kill switch is on. Returns why it did not run, or the run's id.
 */
export async function runNightlyRouting(): Promise<{ ran: false; reason: string } | { ran: true; runId: string; status: string }> {
  if (os.hostname() === 'homeserv' && process.env.ROUTING_ALLOW_DEV !== '1') return { ran: false, reason: 'host is homeserv — nightly selection runs on prod only' };
  if ((await getSetting<boolean>(SETTINGS_ENABLED_KEY)) === false) return { ran: false, reason: 'kill switch is off' };
  const { id, run } = await runSelectionNow({ trigger: 'cron' });
  return { ran: true, runId: id, status: run.status };
}
