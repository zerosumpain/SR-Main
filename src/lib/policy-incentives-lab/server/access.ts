import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isOwnerEmail } from '$lib/server/access';

/** A real owner session is required even when the development hook bypasses auth. */
export async function requireLabOwner(locals: App.Locals): Promise<string> {
  if (env.POLICY_LAB_ENABLED === '0') error(404, 'Not found');
  const session = await locals.auth();
  if (!isOwnerEmail(session?.user?.email)) error(403, 'Owner session required');
  return session!.user!.email!.toLowerCase();
}
