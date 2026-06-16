import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// The workbench is owner-only: it handles the lead's own working and uploaded artefacts.
// 404 (not 403) for the public even when the project key itself is public.
export const load: LayoutServerLoad = async (event) => {
  const session = await event.locals.auth();
  if (!session?.user) throw error(404, 'Not found');
  event.setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  return {};
};
