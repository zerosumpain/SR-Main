// Link a person's Google address, for the website.
//
// Someone who registered from the iPhone app with Sign in with Apple's "Hide
// My Email" is known here by a relay address (`…@privaterelay.appleid.com`),
// and the website signs in with Google only — so they could never use it. The
// owner links their Google address on their person page: the person MOVES to
// it (it becomes their `allowed_user.email`, the key the whole site speaks
// in), and the old address stays on as an alias, so signing in with Apple on
// another phone still finds them ($lib/server/registration).
//
// Everything keyed by the address moves with it, in one transaction: their
// principal's reference (so their chat, notes, intel, drive and workflows —
// all keyed by principal id — are untouched), their phone credentials (so
// their phones keep working), their household row, their requests, and their
// news favourites and reads. The companion server moves first, and a failure
// there stops everything: half a move would detach their family view.
//
// Spec: docs/superpowers/specs/2026-09-28-people-and-app-registration.md

import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  accessRequest,
  activityPrincipals,
  allowedUser,
  appSettings,
  householdMember,
  nativeCredentials,
  newsFavourites,
  newsReads,
} from '$lib/db/schema';
import { isOwnerEmail } from '$lib/server/access';
import { asList } from '$lib/server/grants';
import { loadCompanionUsers } from '$lib/home/presence/companion';
import { pilotFailureText, renamePilotUser } from '$lib/home/presence/companion-accounts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LinkRefusal =
  | 'bad-email'
  | 'same'
  | 'owner'
  | 'not-an-account'
  | 'taken'
  | 'household-taken';

/** Why a link cannot happen, before anything is touched. PURE. */
export function refuseLink(input: {
  from: string;
  to: string;
  toIsOwner: boolean;
  fromIsAccount: boolean;
  toIsTaken: boolean;
  toInHouseholdElsewhere: boolean;
}): LinkRefusal | null {
  const from = input.from.trim().toLowerCase();
  const to = input.to.trim().toLowerCase();
  if (!EMAIL.test(to) || to.length > 254) return 'bad-email';
  if (to === from) return 'same';
  if (input.toIsOwner) return 'owner';
  if (!input.fromIsAccount) return 'not-an-account';
  if (input.toIsTaken) return 'taken';
  if (input.toInHouseholdElsewhere) return 'household-taken';
  return null;
}

export const LINK_REFUSAL_TEXT: Record<LinkRefusal, string> = {
  'bad-email': 'Enter the Google address they sign in with.',
  same: 'That is already their address.',
  owner: 'That is the Super Admin’s address.',
  'not-an-account': 'Only someone with an account can link an address.',
  taken: 'Someone else already signs in with that address. Remove them first, or link a different one.',
  'household-taken': 'Another household person already has that address.',
};

export type LinkResult = { ok: true; email: string } | { ok: false; error: string };

export async function linkSignInEmail(fromRaw: string, toRaw: string): Promise<LinkResult> {
  const from = fromRaw.trim().toLowerCase();
  const to = toRaw.trim().toLowerCase();

  const [account] = await db.select().from(allowedUser).where(eq(allowedUser.email, from)).limit(1);
  const [taken] = await db
    .select({ email: allowedUser.email })
    .from(allowedUser)
    .where(sql`${allowedUser.email} = ${to} OR ${allowedUser.aliases} ? ${to}`)
    .limit(1);
  const [elsewhere] = await db
    .select({ subject: householdMember.subject })
    .from(householdMember)
    .where(sql`lower(${householdMember.email}) = ${to}`)
    .limit(1);
  const refusal = refuseLink({
    from,
    to,
    toIsOwner: isOwnerEmail(to),
    fromIsAccount: !!account,
    // Their own alias is theirs to move onto.
    toIsTaken: !!taken && taken.email !== from,
    toInHouseholdElsewhere: !!elsewhere,
  });
  if (refusal) return { ok: false, error: LINK_REFUSAL_TEXT[refusal] };

  // The companion server first. Someone with an app account there is moved,
  // or nothing is: the household pull, the family view and their phone all
  // find them there by address.
  const companion = await loadCompanionUsers().catch(() => null);
  if (companion?.some((u) => u.email.toLowerCase() === from)) {
    const moved = await renamePilotUser(from, to);
    if (!moved.ok) return { ok: false, error: `The app server did not move them: ${pilotFailureText(moved.reason)}` };
  }

  const aliases = [...new Set([...asList(account.aliases).filter((a): a is string => typeof a === 'string'), from])].filter(
    (a) => a !== to,
  );
  await db.transaction(async (tx) => {
    await tx.update(allowedUser).set({ email: to, aliases }).where(eq(allowedUser.email, from));
    await tx
      .update(activityPrincipals)
      .set({ externalRef: to })
      .where(and(eq(activityPrincipals.kind, 'user'), eq(activityPrincipals.externalRef, from)));
    await tx.update(nativeCredentials).set({ ownerEmail: to }).where(eq(nativeCredentials.ownerEmail, from));
    await tx.update(householdMember).set({ email: to, updatedAt: new Date() }).where(sql`lower(${householdMember.email}) = ${from}`);
    await tx.update(accessRequest).set({ email: to }).where(eq(accessRequest.email, from));
    await tx.update(newsFavourites).set({ ownerKey: to }).where(eq(newsFavourites.ownerKey, from));
    await tx.update(newsReads).set({ ownerKey: to }).where(eq(newsReads.ownerKey, from));
    await tx
      .update(appSettings)
      .set({ key: `news.lastVisit.${to}` })
      .where(eq(appSettings.key, `news.lastVisit.${from}`));
  });
  return { ok: true, email: to };
}
