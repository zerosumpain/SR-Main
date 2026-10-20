// The ONE way onto the allow-list, and the one way to change what a person
// holds without losing their phones.
//
// Six paths used to write `allowed_user` — the add form, an accepted invite,
// an approved request, a pre-registered family member, "give them an account"
// and "pair a phone for someone" — and only two of them put the person's
// phones back afterwards. The `security_user_access` trigger
// (scripts/migrations/2026-09-28-security-lifecycle.sql) revokes EVERY phone
// credential of an email on any insert, or any update to its groups, grants
// or role: so approving someone, or widening what they hold, dropped their
// app back to the start (2026-10-19, and again with vouching).
//
// Decision (2026-10-20): every write here is wrapped in `keepingPhones`. The
// phones are read before the write and put back after it, whoever the person
// is — on the list already or not. Nothing is granted by that: each phone
// re-derives its access on every request (`withNativeAccess`), so a phone
// carried across a change holds exactly what the row now says. Removal is the
// one write that must still revoke, and `removePerson` does it itself.

import { and, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessSecurityAudit, allowedUser, nativeCredentials } from '$lib/db/schema';
import { isOwnerEmail } from './access';
import { addToAllowList } from './allow-list';
import { asList, setUserAccess } from './grants';

export type LivePhone = Pick<
  typeof nativeCredentials.$inferSelect,
  'id' | 'apnsToken' | 'apnsTokenAt' | 'laStartToken' | 'laStartTokenAt'
>;

/** The live phone credentials of someone, read just before a write that would revoke them. None for the owner. */
export async function livePhones(email: string): Promise<LivePhone[]> {
  const e = email.trim().toLowerCase();
  if (isOwnerEmail(e)) return [];
  return db
    .select({
      id: nativeCredentials.id,
      apnsToken: nativeCredentials.apnsToken,
      apnsTokenAt: nativeCredentials.apnsTokenAt,
      laStartToken: nativeCredentials.laStartToken,
      laStartTokenAt: nativeCredentials.laStartTokenAt,
    })
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.ownerEmail, e),
        eq(nativeCredentials.kind, 'device'),
        isNull(nativeCredentials.revokedAt),
        gt(nativeCredentials.expiresAt, new Date()),
      ),
    );
}

/** The database's clock, which is the one the trigger stamps `revoked_at` with. */
export async function databaseNow(): Promise<Date> {
  const r = await db.execute<{ now: Date | string }>(sql`SELECT now() AS now`);
  return new Date(r.rows[0].now);
}

/**
 * Put back exactly the phones `livePhones` saw, and only where the revocation
 * is the one this write caused (at or after `since`) — a phone revoked before
 * it, or by anything else, stays revoked. Recorded in the security audit
 * beside the trigger's own line.
 */
export async function carryPhones(email: string, phones: readonly LivePhone[], since: Date): Promise<number> {
  let carried = 0;
  for (const p of phones) {
    const rows = await db
      .update(nativeCredentials)
      .set({ revokedAt: null, apnsToken: p.apnsToken, apnsTokenAt: p.apnsTokenAt, laStartToken: p.laStartToken, laStartTokenAt: p.laStartTokenAt })
      .where(and(eq(nativeCredentials.id, p.id), gte(nativeCredentials.revokedAt, since)))
      .returning({ id: nativeCredentials.id });
    carried += rows.length;
  }
  if (carried) {
    await db.insert(accessSecurityAudit).values({ email: email.trim().toLowerCase(), reason: 'phone-carried' });
  }
  return carried;
}

export interface PhoneDeps {
  livePhones: typeof livePhones;
  databaseNow: typeof databaseNow;
  carryPhones: typeof carryPhones;
}

const dbPhones: PhoneDeps = { livePhones, databaseNow, carryPhones };

/** Run a write to this person's allow-list row, and put back the phones it revoked. */
export async function keepingPhones<T>(
  email: string,
  write: () => Promise<T>,
  deps: PhoneDeps = dbPhones,
): Promise<{ result: T; carried: number }> {
  const phones = await deps.livePhones(email);
  const since = await deps.databaseNow();
  const result = await write();
  const carried = phones.length ? await deps.carryPhones(email, phones, since) : 0;
  return { result, carried };
}

/**
 * Add groups to a person without taking any away, and keep their one-off
 * grants. `setUserAccess` REPLACES both, which is right for the owner's editor
 * and wrong here: approving a request must never quietly demote someone.
 * Not wrapped in `keepingPhones` itself — the callers here are.
 */
export async function joinGroups(email: string, groups: readonly string[]): Promise<void> {
  if (groups.length === 0) return;
  const e = email.trim().toLowerCase();
  const [row] = await db
    .select({ groups: allowedUser.groups, grants: allowedUser.grants })
    .from(allowedUser)
    .where(eq(allowedUser.email, e))
    .limit(1);
  if (!row) return;
  const current = asList(row.groups).filter((g): g is string => typeof g === 'string');
  await setUserAccess(e, { groups: [...current, ...groups.filter((g) => !current.includes(g))], grants: asList(row.grants) });
}

export interface AdmitInput {
  email: string;
  /** What the site calls them; an existing note is kept when this is empty. */
  name?: string | null;
  /** Roles to join (never demoting). */
  groups?: readonly string[];
  addedBy: string | null;
}

export interface Admission {
  email: string;
  /** False when they were on the list already. */
  created: boolean;
  /** Phones put back after the trigger revoked them. */
  carried: number;
}

export interface AdmitDeps extends PhoneDeps {
  isListed: (email: string) => Promise<boolean>;
  add: typeof addToAllowList;
  join: typeof joinGroups;
}

const dbAdmit: AdmitDeps = {
  ...dbPhones,
  async isListed(email) {
    const [row] = await db.select({ email: allowedUser.email }).from(allowedUser).where(eq(allowedUser.email, email)).limit(1);
    return row !== undefined;
  },
  add: addToAllowList,
  join: joinGroups,
};

/**
 * Put someone on the allow-list with these groups, keeping their phones. The
 * owner is never admitted: he is configured (`AUTH_ALLOWED_EMAILS`), and a
 * row for him would be a second, weaker source of his access.
 */
export async function admitToAllowList(input: AdmitInput, deps: AdmitDeps = dbAdmit): Promise<Admission> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error('Admit whom?');
  if (isOwnerEmail(email)) throw new Error('The owner is configured, not admitted.');
  const listed = await deps.isListed(email);
  const { carried } = await keepingPhones(
    email,
    async () => {
      await deps.add({ email, note: input.name ?? null, addedBy: input.addedBy });
      await deps.join(email, input.groups ?? []);
    },
    deps,
  );
  return { email, created: !listed, carried };
}
