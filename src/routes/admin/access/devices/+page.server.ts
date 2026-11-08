import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** The fleet moved to /admin/access/app (2026-10-20); old links and bookmarks land there. */
export const load: PageServerLoad = async () => {
  redirect(308, '/admin/access/app');
};
