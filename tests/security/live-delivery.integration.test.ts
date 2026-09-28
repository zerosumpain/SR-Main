import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (email: string) => email === 'local-owner@example.invalid' }));
const local = process.env.SR_SECURITY_LOCAL_DB === '1';
describe.skipIf(!local)('Live Activity delivery against local PostgreSQL', () => {
  it('never sends to expired/revoked devices and redacts a reader who lost eligibility', async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('15445');
    const { db } = await import('$lib/db');
    const { pushToViewers, TEST_SUBJECT } = await import('$lib/home/presence/live-journey');
    const journey = `security-delivery-${randomUUID()}`;
    const devices = Array.from({ length: 5 }, () => randomUUID());
    try {
      await db.execute(sql`INSERT INTO household_journey(id,subject,from_place_id,started_at)
        VALUES(${journey},${TEST_SUBJECT},'synthetic',now())`);
      for (let i = 0; i < devices.length; i++) {
        await db.execute(sql`INSERT INTO native_credentials(id,kind,owner_email,token_hash,expires_at,revoked_at,live_activity_enabled)
          VALUES(${devices[i]},'device',${i === 3 ? 'removed@example.invalid' : 'local-owner@example.invalid'},${devices[i]},
            ${new Date(Date.now() + (i === 1 ? -60000 : 60000))},${i === 2 ? new Date() : null},${i !== 4})`);
        await db.execute(sql`INSERT INTO household_journey_viewer(journey_id,device_id,update_token)
          VALUES(${journey},${devices[i]},${String(i).repeat(64)})`);
      }
      const calls: Array<{ token: string; aps: Record<string, unknown> }> = [];
      await pushToViewers(journey, { event: 'update', 'content-state': { headline: 'Synthetic sensitive journey' } }, async (token, aps) => {
        calls.push({ token, aps }); return { ok: true, status: 200 };
      });
      expect(calls.map(c => c.token).sort()).toEqual(['0'.repeat(64), '3'.repeat(64), '4'.repeat(64)]);
      expect(calls.find(c => c.token === '0'.repeat(64))?.aps.event).toBe('update');
      const redacted = calls.find(c => c.token === '3'.repeat(64))?.aps;
      expect(redacted?.event).toBe('end');
      expect(JSON.stringify(redacted)).not.toContain('Synthetic sensitive');
      expect(calls.find(c => c.token === '4'.repeat(64))?.aps.event).toBe('end');
      expect(JSON.stringify(calls.find(c => c.token === '4'.repeat(64)))).not.toContain('Synthetic sensitive');
      expect((await db.execute(sql`SELECT device_id FROM household_journey_viewer WHERE journey_id=${journey} AND device_id=${devices[3]}`)).rows).toEqual([]);
    } finally {
      await db.execute(sql`DELETE FROM household_journey_viewer WHERE journey_id=${journey}`);
      await db.execute(sql`DELETE FROM household_journey WHERE id=${journey}`);
      for (const id of devices) await db.execute(sql`DELETE FROM native_credentials WHERE id=${id}`);
    }
  });
});
