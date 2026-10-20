import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessGroup, accessSecurityAudit, allowedUser, companionAccessVersion, nativeCredentials } from '$lib/db/schema';

// The security trigger itself (scripts/migrations/2026-09-28-security-lifecycle.sql),
// as it stands since 2026-10-20: only a NARROWING of someone's access revokes
// their phones and bumps the version the companion pilot checks. Adding them,
// giving them more, or widening a group they are in leaves every credential
// standing, with an audit row saying so. Removal, a change of address and
// anything taken away revoke as before.
//
// The file is re-applied here unconditionally (it is idempotent), so this
// runs against the functions the next release installs, not whatever an
// older database holds. Touches only rows it creates (this run's tag).

const TAG = `t${Math.random().toString(36).slice(2, 10)}`;
const PERSON = `person-${TAG}@example.test`;
const LEGACY = `legacy-${TAG}@example.test`;
const GROUPED = `grouped-${TAG}@example.test`;
const GROUP = `group-${TAG}`;
const EMAILS = [PERSON, LEGACY, GROUPED];

async function phone(email: string, label: string): Promise<string> {
  const [row] = await db
    .insert(nativeCredentials)
    .values({ kind: 'device', ownerEmail: email, tokenHash: `${TAG}-${label}`, label, expiresAt: new Date(Date.now() + 86_400_000), apnsToken: `apns-${label}` })
    .returning({ id: nativeCredentials.id });
  return row.id;
}

async function live(id: string): Promise<boolean> {
  const [row] = await db.select({ revokedAt: nativeCredentials.revokedAt }).from(nativeCredentials).where(eq(nativeCredentials.id, id));
  return row?.revokedAt === null;
}

async function version(email: string): Promise<number | null> {
  const [row] = await db.select({ version: companionAccessVersion.version }).from(companionAccessVersion).where(eq(companionAccessVersion.email, email));
  return row ? Number(row.version) : null;
}

async function reasons(email: string): Promise<string[]> {
  const rows = await db.select({ reason: accessSecurityAudit.reason, id: accessSecurityAudit.id }).from(accessSecurityAudit).where(eq(accessSecurityAudit.email, email));
  return rows.sort((a, b) => Number(a.id) - Number(b.id)).map((r) => r.reason);
}

describe.skipIf(!process.env.DATABASE_URL)('the security trigger', () => {
  beforeAll(async () => {
    await db.execute(sql.raw(readFileSync(join(process.cwd(), 'scripts/migrations/2026-09-28-security-lifecycle.sql'), 'utf8')));
  });

  afterAll(async () => {
    await db.delete(nativeCredentials).where(inArray(nativeCredentials.ownerEmail, EMAILS));
    await db.delete(allowedUser).where(inArray(allowedUser.email, EMAILS));
    await db.delete(accessGroup).where(eq(accessGroup.id, GROUP));
    await db.delete(companionAccessVersion).where(inArray(companionAccessVersion.email, EMAILS));
    await db.delete(accessSecurityAudit).where(inArray(accessSecurityAudit.email, EMAILS));
  });

  it('leaves a phone alone when its person is added, and when they are given more', async () => {
    const id = await phone(PERSON, 'first');
    await db.insert(allowedUser).values({ email: PERSON, note: 'trigger test', groups: ['family-circle'], grants: [] });
    expect(await live(id)).toBe(true);
    expect(await version(PERSON)).toBeNull();

    await db.update(allowedUser).set({ groups: ['family-circle', 'friend'] }).where(eq(allowedUser.email, PERSON));
    await db.update(allowedUser).set({ grants: ['news:self'] }).where(eq(allowedUser.email, PERSON));
    expect(await live(id)).toBe(true);
    expect(await version(PERSON)).toBeNull();
    expect(await reasons(PERSON)).toEqual(['account-added', 'access-widened', 'access-widened']);
  });

  it('revokes, and bumps the version the pilot checks, when something is taken away', async () => {
    const id = await phone(PERSON, 'second');
    await db.update(allowedUser).set({ groups: ['friend'] }).where(eq(allowedUser.email, PERSON));
    expect(await live(id)).toBe(false);
    // The version row is made by the first invalidation, at 1.
    expect(await version(PERSON)).toBe(1);
    expect((await reasons(PERSON)).at(-1)).toBe('access-narrowed');

    const again = await phone(PERSON, 'third');
    await db.update(allowedUser).set({ grants: [] }).where(eq(allowedUser.email, PERSON));
    expect(await live(again)).toBe(false);
    expect(await version(PERSON)).toBe(2);
  });

  it('reads a legacy role being replaced as a narrowing — the safe reading', async () => {
    const id = await phone(LEGACY, 'legacy');
    await db.insert(allowedUser).values({ email: LEGACY, note: 'trigger test', role: 'member', groups: [], grants: [] });
    expect(await live(id)).toBe(true);
    await db.update(allowedUser).set({ role: 'guest', groups: ['friend'] }).where(eq(allowedUser.email, LEGACY));
    expect(await live(id)).toBe(false);
  });

  it('still revokes on removal — and a remove/re-add is two versions apart', async () => {
    const id = await phone(PERSON, 'fourth');
    await db.delete(allowedUser).where(eq(allowedUser.email, PERSON));
    expect(await live(id)).toBe(false);
    expect(await version(PERSON)).toBe(3);
    await db.insert(allowedUser).values({ email: PERSON, note: 'trigger test', groups: ['friend'], grants: [] });
    expect(await version(PERSON)).toBe(3);
    expect((await reasons(PERSON)).slice(-2)).toEqual(['account-removed', 'account-added']);
  });

  it("a group gaining grants leaves its members' phones alone; losing them, or going, revokes", async () => {
    await db.insert(accessGroup).values({ id: GROUP, label: 'Trigger test', description: null, grants: ['news:self'], builtIn: false });
    await db.insert(allowedUser).values({ email: GROUPED, note: 'trigger test', groups: [GROUP], grants: [] });
    const id = await phone(GROUPED, 'grouped');

    await db.update(accessGroup).set({ grants: ['news:self', 'games:self'] }).where(eq(accessGroup.id, GROUP));
    expect(await live(id)).toBe(true);
    expect((await reasons(GROUPED)).at(-1)).toBe('group-widened');

    await db.update(accessGroup).set({ grants: ['games:self'] }).where(eq(accessGroup.id, GROUP));
    expect(await live(id)).toBe(false);
    expect((await reasons(GROUPED)).at(-1)).toBe('group-changed');

    const again = await phone(GROUPED, 'grouped-2');
    await db.delete(accessGroup).where(eq(accessGroup.id, GROUP));
    expect(await live(again)).toBe(false);
  });
});
