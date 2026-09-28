import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { companionToken, companionUrl } from '$lib/home/presence/companion';
import { drainPrivacyJobs } from '$lib/home/presence/privacy-jobs';

let draining = false;
/** Runs independently of projection/ingestion so stopped upload traffic is irrelevant. */
export async function privacyMaintenance(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const failures: unknown[] = [];
    try { await drainPrivacyJobs(); } catch (error) { failures.push(error); }
    if (companionToken()) {
      try {
        const url = `${companionUrl()}/api/apple/household/account-deletions`;
        const headers = { Authorization: `Bearer ${companionToken()}`, 'Content-Type': 'application/json' };
        const r = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('Account deletion queue unavailable');
        const { users } = await r.json() as { users: Array<{ email: string; jobId: string | null }> };
        const { eraseAccount, defaultEraseDeps } = await import('./erase');
        for (const user of users) {
          const result = await eraseAccount(user.email, defaultEraseDeps, { pilotConfirmed: true });
          if (!result.ok) throw new Error('Account deletion remains pending');
          if (user.jobId) {
            const ack = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ id: user.jobId }), redirect: 'error', signal: AbortSignal.timeout(8000) });
            if (!ack.ok) throw new Error('Account deletion acknowledgement failed');
          }
        }
      } catch (error) { failures.push(error); }
    }
    // Local retention must still run while the companion is unavailable.
    await db.execute(sql`DELETE FROM daydream_trail WHERE source='companion' AND ts<now()-interval '30 days'`);
    await db.execute(sql`DELETE FROM household_journey_viewer WHERE journey_id IN
      (SELECT id FROM household_journey WHERE started_at<now()-interval '30 days')`);
    await db.execute(sql`DELETE FROM household_journey WHERE started_at<now()-interval '30 days'`);
    await db.execute(sql`DELETE FROM household_event WHERE at<now()-interval '30 days'`);
    await db.execute(sql`DELETE FROM family_steps_day WHERE day<current_date-30`);
    await db.execute(sql`DELETE FROM family_steps_event WHERE day<current_date-30`);
    if (failures.length) throw new AggregateError(failures, 'Privacy jobs remain pending');
  } finally { draining = false; }
}
