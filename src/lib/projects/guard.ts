import { error } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import { db } from '$lib/db';
import { projectVisibility } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isProjectPublic } from './visibility';
import { shareCookieName, validateProjectShare } from './shares';
import { isOwnerEmail } from '$lib/server/access';

/** The bits of a SvelteKit request the guard needs (load events and +server
 *  handlers both satisfy this). */
export interface ProjectGuardCtx {
  locals: App.Locals;
  url: URL;
  cookies: Cookies;
}

/**
 * Guard a SvelteKit-route project. 404s the public when the project is private,
 * UNLESS the request carries a valid share token (in `?t=` or the per-project
 * `psh_<key>` cookie set on first valid hit, so multi-route projects keep access
 * as the recipient navigates between pages).
 *
 * Returns flags so the caller can suppress shared (CDN) caching:
 *  - `authedPrivate`: the signed-in owner is previewing a private project.
 *  - `viaShare`: an unauthenticated recipient opened it via a valid share link.
 * Either flag means the response must be `private, no-store` (never edge-cached).
 */
export async function requireProjectPublic(
  key: string,
  ctx: ProjectGuardCtx,
): Promise<{ authedPrivate: boolean; viaShare: boolean }> {
  const [vis] = await db
    .select({ projectKey: projectVisibility.projectKey, isPublic: projectVisibility.isPublic })
    .from(projectVisibility)
    .where(eq(projectVisibility.projectKey, key));
  const map = vis ? { [vis.projectKey]: vis.isPublic } : {};
  if (isProjectPublic(map, key)) return { authedPrivate: false, viaShare: false };

  // Private from here. The site OWNER can always preview it; a signed-in guest
  // (login allow-list, non-owner) is treated like the public — private projects
  // are owner-only. A valid share token still grants access without sign-in.
  const session = await ctx.locals.auth();
  if (isOwnerEmail(session?.user?.email)) return { authedPrivate: true, viaShare: false };

  // Otherwise a valid share token grants access without sign-in.
  if (await resolveShareToken(key, ctx)) return { authedPrivate: false, viaShare: true };

  throw error(404, 'Not found');
}

/**
 * Read a share token from `?t=` (then the project cookie), validate it, and on a
 * fresh URL token persist a project-scoped httpOnly cookie so in-project
 * navigation keeps working. Returns true if access is granted. Shared so the
 * inline static-bundle handler can reuse identical logic.
 */
export async function resolveShareToken(key: string, ctx: ProjectGuardCtx): Promise<boolean> {
  const cookieName = shareCookieName(key);
  const fromUrl = ctx.url.searchParams.get('t');
  const token = fromUrl || ctx.cookies.get(cookieName) || '';
  if (!token || !(await validateProjectShare(key, token))) return false;
  if (fromUrl) {
    // Scope to /projects so it is never sent to other parts of the site; the
    // cookie NAME is per-project and the token is validated against this key.
    ctx.cookies.set(cookieName, token, {
      path: '/projects',
      httpOnly: true,
      secure: ctx.url.protocol === 'https:',
      sameSite: 'lax',
      maxAge: 60 * 60 * 12, // 12h; re-opening the link refreshes it
    });
  }
  return true;
}
