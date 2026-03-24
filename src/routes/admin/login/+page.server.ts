import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Old login page — redirect to new auth flow
  throw redirect(302, '/auth/signin?callbackUrl=/admin');
};
