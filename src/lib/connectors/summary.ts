// Cheap "does anything need my attention?" summary for the landing page.
//
// The dashboard at /admin/connections probes every connector live — a Gmail
// token refresh, an OpenRouter credits call, a Home Assistant round-trip. That
// is right for a page you opened on purpose and wrong for the front door of the
// site, which would then pay several seconds of third-party latency on every
// owner visit just to render a banner that is usually absent.
//
// So this reads stored state only: four indexed queries, no network. The
// asymmetry that makes it honest is that stored state is trustworthy in the
// direction that matters here — `gmail_accounts.status` only says auth_expired
// because a real refresh really failed, and `health_sync_state.status` only
// says error because a real sync really failed. The failure mode is the
// opposite one: a connector that broke without anything having tried to use it
// yet still looks fine. Staleness covers most of that, and the banner is a
// pointer rather than a verdict — the page it links to does the live probing
// and is the authority.

import { db } from '$lib/db';
import { appleHealthMetrics, gmailAccounts, healthSyncState, integrationCredentials } from '$lib/db/schema';
import { inArray, ne, sql } from 'drizzle-orm';

/** A sync is "stalled" once nothing has landed for this long. */
const STALE_MS = 3 * 24 * 3600 * 1000;
/** Apple Health arrives by webhook many times a day, so it goes stale far sooner. */
const APPLE_STALE_MS = 48 * 3600 * 1000;

export interface SyncAttentionSummary {
  /** How many accounts need looking at. 0 means render nothing. */
  count: number;
  /** Display names, worst-first-ish, for the banner copy. */
  names: string[];
}

export async function syncAttentionSummary(): Promise<SyncAttentionSummary> {
  const now = Date.now();
  const names: string[] = [];

  const [gmailBad, healthRows, appleRow, credsBad] = await Promise.all([
    db
      .select({ email: gmailAccounts.email })
      .from(gmailAccounts)
      .where(ne(gmailAccounts.status, 'active'))
      .catch(() => []),
    // Whoop only. Two services with a row here are deliberately excluded:
    //
    // `apple_health` is permanently months stale — it is written by a pull-sync
    // job that no longer runs, while the webhook keeps delivering.
    //
    // `strava` is dormant: Strava restricted its API to paid subscribers, so its
    // sync fails every hour and always will. It is not a fault to be fixed, and
    // a banner naming it every day is exactly how a banner stops being read.
    // See DORMANT in ./probes.ts — that is the switch to flip if it comes back.
    db
      .select({
        service: healthSyncState.service,
        status: healthSyncState.status,
        lastOk: healthSyncState.lastSuccessfulSyncAt,
      })
      .from(healthSyncState)
      .where(inArray(healthSyncState.service, ['whoop']))
      .catch(() => []),
    db
      .select({ latest: sql<number | null>`max(${appleHealthMetrics.date})` })
      .from(appleHealthMetrics)
      .catch(() => [{ latest: null }]),
    db
      .select({ label: integrationCredentials.label })
      .from(integrationCredentials)
      .where(sql`${integrationCredentials.lastTestStatus} = 'failed'`)
      .catch(() => []),
  ]);

  if (gmailBad.length) names.push('Gmail');

  for (const row of healthRows) {
    const stalled = row.lastOk !== null && now - row.lastOk * 1000 > STALE_MS;
    if (row.status === 'error' || stalled) {
      names.push(row.service === 'strava' ? 'Strava' : row.service === 'whoop' ? 'Whoop' : row.service);
    }
  }

  const latest = appleRow[0]?.latest ?? null;
  if (latest !== null && now - latest * 1000 > APPLE_STALE_MS) names.push('Apple Health');

  for (const c of credsBad) names.push(c.label);

  return { count: names.length, names };
}
