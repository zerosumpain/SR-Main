// src/lib/daydream/think/ledger.server.ts — the store behind `ledger.ts`.
//
// One `app_settings` row. Think cycles run one at a time (the heartbeat
// leases them), so read-at-start / merge-at-end cannot lose a test; a test that
// races anyway costs one entry, never the cycle.

import { getSetting, setSetting } from '$lib/server/models/settings';
import { LEDGER_SETTING, LEDGER_SUMMARY_SETTING, parseLedger, recordTest, type Ledger, type LedgerEntry } from './ledger';

export async function loadLedger(): Promise<Ledger> {
  return parseLedger(await getSetting(LEDGER_SETTING).catch(() => null));
}

/** Merge a cycle's fresh tests into the stored ledger. Re-read first, so the
 *  write is against the row as it is now, not as the cycle found it. */
export async function saveTests(entries: readonly LedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;
  let ledger = await loadLedger();
  for (const e of entries) ledger = recordTest(ledger, e);
  await setSetting(LEDGER_SETTING, ledger);
}

export async function lastSummaryAt(): Promise<string | null> {
  const v = await getSetting<string>(LEDGER_SUMMARY_SETTING).catch(() => null);
  return typeof v === 'string' ? v : null;
}

export async function markSummary(now: Date): Promise<void> {
  await setSetting(LEDGER_SUMMARY_SETTING, now.toISOString());
}
