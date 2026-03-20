import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
  // Always clear stale session when visiting login page
  cookies.delete('admin_session', { path: '/' });
  return {};
};
