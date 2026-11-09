import { createHmac } from 'node:crypto';
import type { AnalyticsIdentity } from '$lib/analytics/umami';
import type { Viewer } from '$lib/server/viewer';

/**
 * The label a signed-in session carries into Umami: a role, and an id that is
 * stable per account but cannot be turned back into it.
 *
 * The id is an HMAC over the email keyed by AUTH_SECRET — never the email, and
 * never a bare hash of it (an unkeyed hash of an address is reversible by
 * guessing addresses). The owner is simply `owner`. Anonymous visitors get
 * nothing: they are never identified.
 *
 * No secret, no id: the role alone is still sent, as the id, so the owner's
 * traffic can be filtered even on a host missing AUTH_SECRET.
 */
export function analyticsIdentity(viewer: Viewer, secret: string | undefined): AnalyticsIdentity | null {
  if (viewer.kind === 'anonymous') return null;
  if (viewer.kind === 'owner') return { id: 'owner', role: 'owner' };
  const role = viewer.kind;
  if (!secret) return { id: role, role };
  const digest = createHmac('sha256', secret).update(`umami:${viewer.email.trim().toLowerCase()}`).digest('hex');
  return { id: `${role}-${digest.slice(0, 16)}`, role };
}
