// "View as" — the owner sees the site exactly as one person on the allow-list
// would, to check what a friend or family member can reach before (and after)
// giving them access.
//
// It is the web twin of `actAsDeviceMember` ($lib/server/native-gate): the rest
// of the request is made to look like that person signed in, by overwriting
// both ways the site asks "who is this" — `locals.viewer` (the hook's grant
// gate, every area seam, the nav) and `locals.auth()` (the `/api` gate, every
// `isOwnerEmail(session.user.email)` and `isOwnerRequest` check). Nothing
// downstream knows it is being emulated, which is the point: it exercises the
// same code a real session would.
//
// Safety:
//  - Only the OWNER can be emulating. The cookie is honoured only when the real
//    session is an owner session AND the cookie was signed (AUTH_SECRET) for
//    that owner's email, so a forged or borrowed cookie does nothing.
//  - Read-only. The hook refuses every state-changing request while emulating
//    (`VIEW_AS_WRITE_REFUSED`), so the owner cannot post chat turns as the
//    person, spend their daily allowances or write rows into their space.
//  - It expires after an hour, and the target is re-read from the allow-list on
//    every request: remove the person and the emulation ends.
//  - The exit endpoint (`VIEW_AS_PATH`) is never emulated, so the owner can
//    always leave.
//
// The other applications on the domain (SR-Jkai-Core, SR-Drive, SR-Health) are
// emulated at the SR-Infra gateway, which verifies this same cookie and signs the
// target's identity instead (gateway/view-as.mjs; the format must match).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { isOwnerEmail } from './access';
import { loadMember } from './grants';
import type { Viewer } from './viewer';

export const VIEW_AS_COOKIE = 'sr_view_as';
export const VIEW_AS_PATH = '/api/admin/access/view-as';
export const VIEW_AS_TTL_S = 60 * 60;

export interface ViewingAs {
  email: string;
  kind: 'member' | 'guest';
  /** Unix ms. */
  expiresAt: number;
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`view-as:${body}`).digest('base64url');
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

/** The cookie value: the target, an expiry, and a MAC binding both to the owner. */
export function signViewAs(secret: string, owner: string, target: string, now = Date.now()): string {
  if (!secret) throw new Error('AUTH_SECRET is not set — cannot sign a view-as cookie');
  const body = `${b64(target.trim().toLowerCase())}.${now + VIEW_AS_TTL_S * 1000}`;
  return `${body}.${mac(secret, `${owner.trim().toLowerCase()}.${body}`)}`;
}

/** The target email, only for a cookie this server signed for `owner` that has not expired. */
export function verifyViewAs(
  secret: string,
  owner: string,
  value: string | undefined | null,
  now = Date.now(),
): { email: string; expiresAt: number } | null {
  if (!secret || !value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [target, exp, sig] = parts;
  const expected = Buffer.from(mac(secret, `${owner.trim().toLowerCase()}.${target}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresAt = Number(exp);
  if (!(expiresAt > now)) return null;
  const email = Buffer.from(target, 'base64url').toString('utf8');
  return email ? { email, expiresAt } : null;
}

/**
 * Who `email` is to the site, or null when they cannot be emulated: the owner
 * (nothing to see), or anyone not on the allow-list (they could not sign in).
 */
export async function viewerForEmail(email: string): Promise<Viewer | null> {
  const e = email.trim().toLowerCase();
  if (!e || isOwnerEmail(e)) return null;
  const [row] = await db.select({ email: allowedUser.email }).from(allowedUser).where(eq(allowedUser.email, e)).limit(1);
  if (!row) return null;
  const member = await loadMember(e);
  return member
    ? { kind: 'member', principalId: member.principalId, email: e, grants: member.grants }
    : { kind: 'guest', email: e };
}

/**
 * Make the rest of this request see `viewer`, as `actAsDeviceMember` does for a
 * phone. Both answers are overwritten, never filled in, so nothing the owner's
 * own session carries can widen it.
 */
export function actAs(locals: App.Locals, viewer: Viewer & { email: string }, expiresAt: number): void {
  locals.viewer = Promise.resolve(viewer);
  const session = { user: { email: viewer.email }, expires: new Date(expiresAt).toISOString() };
  locals.auth = async () => session;
  locals.viewingAs = {
    email: viewer.email,
    kind: viewer.kind === 'member' ? 'member' : 'guest',
    expiresAt,
  };
}

export const VIEW_AS_WRITE_REFUSED = 'Read-only while viewing as someone else. Exit view-as to make changes.';
