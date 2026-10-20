import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessRequest, allowedUser, householdMember, nativeCredentials } from '$lib/db/schema';
import { decideRequest } from './access-requests';
import { ensureAppRequest } from './registration';
import { removePerson } from '$lib/people/people.server';

// Approving someone who signed up from the app, against the REAL security
// trigger (scripts/migrations/2026-09-28-security-lifecycle.sql must be
// installed). Joining the allow-list revokes every phone the email holds; the
// registrant's own phone is the one approval must carry over. 2026-10-19: it
// did not, the approved phone fell back to the start, and its holder went
// looking for a QR on the owner's screen.
//
// Touches only rows it creates (named with this run's tag) and deletes them.

const TAG = `r${Math.random().toString(36).slice(2, 10)}`;
const SON = `son-${TAG}@example.test`;
const KNOWN = `known-${TAG}@example.test`;
const FAMILY = `family-${TAG}@example.test`;
const STRANGER = `stranger-${TAG}@example.test`;

async function trigger(): Promise<boolean> {
  const r = await db.execute(sql`SELECT 1 FROM pg_trigger WHERE tgname = 'security_user_access'`);
  return r.rows.length > 0;
}

async function phone(email: string, label: string): Promise<string> {
  const [row] = await db
    .insert(nativeCredentials)
    .values({ kind: 'device', ownerEmail: email, tokenHash: `${TAG}-${label}`, label, expiresAt: new Date(Date.now() + 86_400_000), apnsToken: `apns-${label}` })
    .returning({ id: nativeCredentials.id });
  return row.id;
}

async function state(id: string) {
  const [row] = await db
    .select({ revokedAt: nativeCredentials.revokedAt, apnsToken: nativeCredentials.apnsToken })
    .from(nativeCredentials)
    .where(eq(nativeCredentials.id, id));
  return row;
}

async function request(email: string): Promise<string> {
  const [row] = await db
    .insert(accessRequest)
    .values({ email, name: 'Son Example', message: null, wants: { app: true, via: 'apple' }, ipHash: null })
    .returning({ id: accessRequest.id });
  return row.id;
}

describe.skipIf(!process.env.DATABASE_URL)('approving a request from the app', () => {
  beforeAll(async () => {
    // The nightly database is a bare drizzle push; production also has the
    // release's security triggers. The file is idempotent — install it so this
    // runs against what production runs.
    if (!(await trigger())) {
      await db.execute(sql.raw(readFileSync(join(process.cwd(), 'scripts/migrations/2026-09-28-security-lifecycle.sql'), 'utf8')));
    }
  });

  afterAll(async () => {
    const all = [SON, KNOWN, FAMILY, STRANGER];
    await db.delete(nativeCredentials).where(inArray(nativeCredentials.ownerEmail, all));
    await db.delete(accessRequest).where(inArray(accessRequest.email, all));
    await db.delete(allowedUser).where(inArray(allowedUser.email, all));
    await db.delete(householdMember).where(eq(householdMember.subject, `pre-${TAG}`));
  });

  it('keeps the phone that asked, push token and all', async () => {
    expect(await trigger()).toBe(true);
    const id = await phone(SON, 'asked');
    const row = await decideRequest(await request(SON), 'approve', { groups: ['family-circle'], decidedBy: 'owner@example.test' });
    expect(row?.status).toBe('approved');
    expect(await state(id)).toEqual({ revokedAt: null, apnsToken: 'apns-asked' });
  });

  it('keeps the phones of someone already on the list too: widening what they hold is not a reason to sign them out (2026-10-20)', async () => {
    await db.insert(allowedUser).values({ email: KNOWN, note: 'access-requests.integration' });
    const id = await phone(KNOWN, 'known');
    await decideRequest(await request(KNOWN), 'approve', { groups: ['family-circle'], decidedBy: 'owner@example.test' });
    expect(await state(id)).toEqual({ revokedAt: null, apnsToken: 'apns-known' });
  });

  it('leaves removal alone: taking the account away still revokes the phone', async () => {
    const id = await phone(SON, 'later');
    await removePerson(SON);
    expect((await state(id))?.revokedAt).not.toBeNull();
  });

  it('lets a pre-registered family member straight in, and only them', async () => {
    // The owner added them to the household, with this address, before they ever signed in.
    await db.insert(householdMember).values({ subject: `pre-${TAG}`, displayName: 'Fam Example', email: FAMILY });
    expect(await ensureAppRequest({ email: FAMILY, name: 'Fam', via: 'apple' })).toBe('allowed');
    const [row] = await db.select({ groups: allowedUser.groups }).from(allowedUser).where(eq(allowedUser.email, FAMILY));
    expect(row?.groups).toEqual(['family-circle']);
    const [req] = await db.select({ status: accessRequest.status }).from(accessRequest).where(eq(accessRequest.email, FAMILY));
    expect(req?.status).toBe('approved');

    // An address the household does not know still asks, and waits.
    expect(await ensureAppRequest({ email: STRANGER, name: 'Stranger', via: 'apple' })).toBe('pending');
    const [none] = await db.select().from(allowedUser).where(eq(allowedUser.email, STRANGER));
    expect(none).toBeUndefined();
  });
});
