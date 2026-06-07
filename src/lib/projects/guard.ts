import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { projectVisibility } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isProjectPublic } from './visibility';

/**
 * Guard a SvelteKit-route project. 404s the public when the project is private.
 * Returns `{ authedPrivate: true }` when the signed-in owner is previewing a
 * private project, so the caller can suppress shared (CDN) caching of that view.
 */
export async function requireProjectPublic(
  key: string,
  locals: App.Locals,
): Promise<{ authedPrivate: boolean }> {
  const [vis] = await db
    .select({ projectKey: projectVisibility.projectKey, isPublic: projectVisibility.isPublic })
    .from(projectVisibility)
    .where(eq(projectVisibility.projectKey, key));
  const map = vis ? { [vis.projectKey]: vis.isPublic } : {};
  if (isProjectPublic(map, key)) return { authedPrivate: false };

  const session = await locals.auth();
  if (!session?.user) throw error(404, 'Not found');
  return { authedPrivate: true };
}
