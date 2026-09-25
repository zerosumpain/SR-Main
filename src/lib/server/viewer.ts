// Who is asking: the owner, a member, a signed-in guest, or nobody.
//
// One answer per request, cached on `locals`, shared by the hook's member gate,
// `resolveRequestScope` and the layouts that trim the chrome for a member. The
// owner is decided from the env allow-list without touching the database (the
// same rule `isOwnerEmail` gives the hook), so only a non-owner session pays
// for the member lookup.
import { isOwnerEmail } from './access';
import { memberPrincipalFor } from './members';

export type Viewer =
  | { kind: 'owner' }
  | { kind: 'member'; principalId: string; email: string }
  | { kind: 'guest'; email: string }
  | { kind: 'anonymous' };

async function resolveViewer(locals: App.Locals): Promise<Viewer> {
  const session = await locals.auth();
  const email = (session?.user?.email ?? '').trim().toLowerCase();
  if (!email) return { kind: 'anonymous' };
  if (isOwnerEmail(email)) return { kind: 'owner' };
  const principalId = await memberPrincipalFor(email);
  return principalId ? { kind: 'member', principalId, email } : { kind: 'guest', email };
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
