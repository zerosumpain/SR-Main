import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Deep-dive settings have been merged into the unified API Keys page.
// Preserve the URL as a permanent redirect so any old bookmarks resolve.
export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get('token');
  const target = token ? `/admin/keys?token=${token}` : '/admin/keys';
  throw redirect(308, target);
};
