// Invite links — `/welcome/<code>` — and the sign-in rule that accepts them.
//
// The allow-list decides who may sign in (see ./access). An invite is a way
// ONTO it that does not need the owner to know the person's Google address in
// advance: the owner mints a one-time link at /admin/access, the person opens
// it, the code rides a short-lived httpOnly cookie through Google, and the
// Auth.js `signIn` callback — which sees the cookie on the OAuth callback
// request — accepts it once. Anything else behaves exactly as before.
//
// The code is a 192-bit secret shown once; only its SHA-256 is stored, the
// same arrangement as native_credentials and project_share. A used, revoked or
// expired invite admits nobody, and an invite made out to an address admits
// only that address.
//
// Spec: docs/superpowers/specs/2026-09-26-apple-app-breakout.md (Contract B)

import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessInvite, allowedUser } from '$lib/db/schema';
import { getOwnerEmails, isEmailAllowedToSignIn } from './access';
import { addToAllowList } from './allow-list';
import { asList, setUserAccess } from './grants';

export type InviteRow = typeof accessInvite.$inferSelect;

/** Fourteen days unless the owner says otherwise. */
export const INVITE_TTL_DAYS = 14;
/** The cookie that carries a code through Google. */
export const INVITE_COOKIE = 'sr_invite';
/** Thirty minutes: long enough to get through Google, short enough not to linger. */
export const INVITE_COOKIE_MAX_AGE_S = 30 * 60;

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** 24 random bytes, base64url: 32 characters, 192 bits. */
export function mintInviteCode(): string {
  return randomBytes(24).toString('base64url');
}

/** Shape check before any lookup: a URL segment that could never be a code costs no query. */
export function isInviteCodeShaped(code: string | null | undefined): code is string {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(code);
}

export type InviteState = 'ok' | 'unknown' | 'used' | 'revoked' | 'expired' | 'email-mismatch';

/**
 * Whether an invite may be accepted, and if not why. PURE.
 *
 * `email` null asks "is the link itself still good?" — what the landing page
 * shows before anyone has signed in. With an email it is the full sign-in
 * rule: an invite made out to someone admits only them.
 */
export function inviteState(
  invite: Pick<InviteRow, 'email' | 'usedAt' | 'revokedAt' | 'expiresAt'> | null | undefined,
  email: string | null,
  now: Date,
): InviteState {
  if (!invite) return 'unknown';
  if (invite.revokedAt) return 'revoked';
  if (invite.usedAt) return 'used';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (email !== null && invite.email && invite.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return 'email-mismatch';
  }
  return 'ok';
}

/** What the sign-in rule needs from the world, so it can be tested without one. */
export interface SignInDeps {
  /** The existing rule: owner env or allow-list row. */
  isAllowed(email: string): Promise<boolean>;
  /** False when AUTH_ALLOWED_EMAILS is empty — the site then admits nobody. */
  ownersConfigured(): boolean;
  findInvite(codeHash: string): Promise<InviteRow | null>;
  /** Spend the invite. False when somebody else spent it first. */
  claimInvite(id: string, email: string, now: Date): Promise<boolean>;
  /** Put them on the allow-list in the invite's groups. */
  admit(invite: InviteRow, email: string): Promise<void>;
  now(): Date;
}

export type SignInOutcome =
  | { allow: true; via: 'allow-list' | 'invite' }
  | { allow: false; reason: 'no-email' | 'not-allowed' | InviteState | 'no-owners' | 'claim-lost' };

/**
 * The Auth.js `signIn` rule.
 *
 * Someone already allowed signs in exactly as before and the invite is NOT
 * spent — it stays usable for whoever it was meant for. Otherwise a valid,
 * unexpired, unused invite whose address (if set) matches admits them once:
 * it is claimed with a conditional update first, so two sign-ins racing on
 * one link cannot both get in, and only then are they added.
 */
export async function decideSignIn(
  email: string,
  code: string | null | undefined,
  deps: SignInDeps,
): Promise<SignInOutcome> {
  const e = email.trim().toLowerCase();
  if (!e) return { allow: false, reason: 'no-email' };
  if (await deps.isAllowed(e)) return { allow: true, via: 'allow-list' };
  if (!isInviteCodeShaped(code)) return { allow: false, reason: 'not-allowed' };
  // Same fail-closed stance as isEmailAllowedToSignIn: a site with no owner
  // configured admits nobody, invite or not.
  if (!deps.ownersConfigured()) return { allow: false, reason: 'no-owners' };

  const now = deps.now();
  const invite = await deps.findInvite(hashInviteCode(code));
  const state = inviteState(invite, e, now);
  if (state !== 'ok' || !invite) return { allow: false, reason: state };
  if (!(await deps.claimInvite(invite.id, e, now))) return { allow: false, reason: 'claim-lost' };
  await deps.admit(invite, e);
  return { allow: true, via: 'invite' };
}

/**
 * Add groups to a person without taking any away, and keep their one-off
 * grants. `setUserAccess` REPLACES both, which is right for the owner's editor
 * and wrong here: approving a request must never quietly demote someone.
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

const dbDeps: SignInDeps = {
  isAllowed: (email) => isEmailAllowedToSignIn(email),
  ownersConfigured: () => getOwnerEmails().length > 0,
  async findInvite(codeHash) {
    const [row] = await db.select().from(accessInvite).where(eq(accessInvite.codeHash, codeHash)).limit(1);
    return row ?? null;
  },
  async claimInvite(id, email, now) {
    const rows = await db
      .update(accessInvite)
      .set({ usedAt: now, usedByEmail: email })
      .where(
        and(
          eq(accessInvite.id, id),
          isNull(accessInvite.usedAt),
          isNull(accessInvite.revokedAt),
          gt(accessInvite.expiresAt, now),
        ),
      )
      .returning({ id: accessInvite.id });
    return rows.length > 0;
  },
  async admit(invite, email) {
    await addToAllowList({ email, note: invite.name ?? invite.note, addedBy: invite.createdBy });
    await joinGroups(email, asList(invite.groups).filter((g): g is string => typeof g === 'string'));
  },
  now: () => new Date(),
};

/**
 * The callback's entry point. Never throws: a database fault denies the
 * sign-in (fail closed) rather than surfacing as an Auth.js error page.
 */
export async function signInWithInvite(email: string, code: string | null | undefined): Promise<SignInOutcome> {
  try {
    return await decideSignIn(email, code, dbDeps);
  } catch (err) {
    console.error('[invites] sign-in check failed:', err);
    return { allow: false, reason: 'not-allowed' };
  }
}

// ── The owner's side ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteView {
  id: string;
  email: string | null;
  name: string | null;
  note: string | null;
  groups: string[];
  createdBy: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedByEmail: string | null;
  revokedAt: Date | null;
  state: InviteState;
}

function view(row: InviteRow, now = new Date()): InviteView {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    note: row.note,
    groups: asList(row.groups).filter((g): g is string => typeof g === 'string'),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    usedByEmail: row.usedByEmail,
    revokedAt: row.revokedAt,
    state: inviteState(row, null, now),
  };
}

/** Mint an invite. The code is returned once and never stored. */
export async function createInvite(input: {
  email?: string | null;
  name?: string | null;
  note?: string | null;
  groups?: readonly unknown[];
  knownGroups: ReadonlySet<string>;
  createdBy: string | null;
  ttlDays?: number;
}): Promise<{ code: string; invite: InviteView } | { error: string }> {
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !EMAIL_RE.test(email)) return { error: 'Enter a valid email address, or leave it blank' };
  const groups = (input.groups ?? []).filter(
    (g, i, all): g is string => typeof g === 'string' && input.knownGroups.has(g) && all.indexOf(g) === i,
  );
  const days = Math.min(Math.max(Math.round(input.ttlDays ?? INVITE_TTL_DAYS), 1), 60);
  const code = mintInviteCode();
  const [row] = await db
    .insert(accessInvite)
    .values({
      codeHash: hashInviteCode(code),
      email,
      name: input.name?.trim().slice(0, 80) || null,
      note: input.note?.trim().slice(0, 200) || null,
      groups,
      createdBy: input.createdBy,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    })
    .returning();
  return { code, invite: view(row) };
}

/** The most recent invites, any state. */
export async function listInvites(limit = 50): Promise<InviteView[]> {
  const rows = await db.select().from(accessInvite).orderBy(desc(accessInvite.createdAt)).limit(limit);
  const now = new Date();
  return rows.map((r) => view(r, now));
}

export async function revokeInvite(id: string): Promise<boolean> {
  const rows = await db
    .update(accessInvite)
    .set({ revokedAt: new Date() })
    .where(and(eq(accessInvite.id, id), isNull(accessInvite.revokedAt), isNull(accessInvite.usedAt)))
    .returning({ id: accessInvite.id });
  return rows.length > 0;
}

/** `jane@gmail.com` → `j•••@gmail.com`: enough to recognise, not to harvest. PURE. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '•••';
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** What the landing page may say about a code: nothing at all unless it is live. */
export async function previewInvite(code: string): Promise<{ state: InviteState; invite: InviteView | null }> {
  if (!isInviteCodeShaped(code)) return { state: 'unknown', invite: null };
  const [row] = await db
    .select()
    .from(accessInvite)
    .where(eq(accessInvite.codeHash, hashInviteCode(code)))
    .limit(1);
  const state = inviteState(row, null, new Date());
  return { state, invite: state === 'ok' && row ? view(row) : null };
}
