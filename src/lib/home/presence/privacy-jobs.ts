import { sql } from 'drizzle-orm';
import { clearSettingsCache } from '$lib/server/models/settings';
import { db } from '$lib/db';
import { companionToken, companionUrl } from './companion';

/** Idempotent consumer. ACK only after all Main copies commit; failures retry. */
export async function drainPrivacyJobs(fetchImpl: typeof fetch = fetch): Promise<number> {
  const token = companionToken();
  if (!token) return 0;
  const call = async (method: string, body?: unknown) => {
    const response = await fetchImpl(`${companionUrl()}/api/apple/household/deletions`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Privacy queue answered ${response.status}`);
    return response.json();
  };
  const { jobs } = await call('GET') as { jobs: Array<{ id: string; email: string; created: string }> };
  let completed = 0;
  for (const job of jobs) {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${job.id}))`);
      const receipt = await tx.execute(sql`SELECT job_id FROM companion_privacy_receipt WHERE job_id=${job.id}`);
      if (receipt.rows.length) return;
      if (!Number.isFinite(Date.parse(job.created))) throw new Error('Invalid deletion timestamp');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'companion-privacy-email:' + job.email}))`);
      const person = await tx.execute<{ subject: string }>(sql`SELECT subject FROM household_member WHERE email=${job.email}`);
      const subject = person.rows[0]?.subject ?? null;
      if (subject) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'companion-privacy-subject:' + subject}))`);
      await tx.execute(sql`INSERT INTO companion_deletion_floor(email,subject,deleted_at) VALUES(${job.email},${subject},${job.created}::timestamptz)
        ON CONFLICT(email) DO UPDATE SET subject=excluded.subject, deleted_at=greatest(companion_deletion_floor.deleted_at,excluded.deleted_at)`);
      for (const { subject } of person.rows) {
        await tx.execute(sql`DELETE FROM daydream_trail WHERE subject=${subject} AND source='companion'`);
        await tx.execute(sql`DELETE FROM household_journey_viewer WHERE journey_id IN (SELECT id FROM household_journey WHERE subject=${subject})`);
        await tx.execute(sql`DELETE FROM household_journey WHERE subject=${subject}`);
        await tx.execute(sql`DELETE FROM household_event WHERE subject=${subject}`);
        await tx.execute(sql`DELETE FROM app_settings WHERE key=${'home.presence.inside.' + subject}`);
        await tx.execute(sql`DELETE FROM app_settings WHERE key=${'home.presence.eta.' + subject}`);
      }
      await tx.execute(sql`DELETE FROM family_steps_day WHERE email=${job.email}`);
      await tx.execute(sql`DELETE FROM family_steps_event WHERE email=${job.email}`);
      await tx.execute(sql`UPDATE native_credentials SET revoked_at=now(),apns_token=NULL,apns_token_at=NULL,
        la_start_token=NULL,la_start_token_at=NULL WHERE owner_email=${job.email}`);
      await tx.execute(sql`DELETE FROM household_journey_viewer WHERE device_id IN
        (SELECT id FROM native_credentials WHERE owner_email=${job.email})`);
      await tx.execute(sql`INSERT INTO companion_privacy_receipt(job_id) VALUES(${job.id}) ON CONFLICT DO NOTHING`);
    });
    clearSettingsCache();
    await call('POST', { id: job.id });
    completed++;
  }
  return completed;
}
