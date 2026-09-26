// Who is asking: the owner, a member, a signed-in guest, or nobody.
//
// One answer per request, cached on `locals`, shared by the hook's grant gate,
// every area's scope seam and the layouts that trim the chrome for a member.
// The owner (Super Admin) is decided from the env allow-list without touching
// the database (the same rule `isOwnerEmail` gives the hook), so only a
// non-owner session pays for the lookup.
//
// A MEMBER is a signed-in non-owner holding at least one permission from the
// catalogue, through their groups or their own grants ($lib/server/grants).
// A signed-in non-owner holding none is a guest.
import type { Permission } from '$lib/access/catalogue';
import { satisfies } from '$lib/access/catalogue';
import { isOwnerEmail } from './access';
import { loadMember } from './grants';

export type Viewer =
  | { kind: 'owner' }
  | { kind: 'member'; principalId: string; email: string; grants: ReadonlySet<Permission> }
  | { kind: 'guest'; email: string }
  | { kind: 'anonymous' };

async function resolveViewer(locals: App.Locals): Promise<Viewer> {
  const session = await locals.auth();
  const email = (session?.user?.email ?? '').trim().toLowerCase();
  if (!email) return { kind: 'anonymous' };
  if (isOwnerEmail(email)) return { kind: 'owner' };
  const member = await loadMember(email);
  return member
    ? { kind: 'member', principalId: member.principalId, email, grants: member.grants }
    : { kind: 'guest', email };
}

export function viewerOf(event: { locals: App.Locals }): Promise<Viewer> {
  const locals = event.locals;
  // A failed lookup is not cached as an answer: the promise is dropped so the
  // next caller in the request asks again rather than inheriting the error.
  locals.viewer ??= resolveViewer(locals).catch((err) => {
    locals.viewer = undefined;
    throw err;
  });
  return locals.viewer;
}

/** True for a member session. Chrome uses it to drop owner-only surfaces. */
export async function isMemberRequest(event: { locals: App.Locals }): Promise<boolean> {
  try {
    return (await viewerOf(event)).kind === 'member';
  } catch {
    return false;
  }
}

/**
 * True when the viewer holds `permission` (or a higher level of its area).
 * The owner holds everything; guests and anonymous requests hold nothing.
 */
export function viewerHolds(viewer: Viewer, permission: Permission): boolean {
  if (viewer.kind === 'owner') return true;
  return viewer.kind === 'member' && satisfies(viewer.grants, permission);
}
