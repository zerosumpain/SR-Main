import { redirect } from '@sveltejs/kit';
import { validateSession, getExpectedHash } from '$lib/auth';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  if (url.pathname === '/admin/login') return {};

  const session = cookies.get('admin_session');
  const expected = getExpectedHash();

  console.log('[admin guard]', {
    pathname: url.pathname,
    cookieFirst8: session?.slice(0, 8),
    expectedFirst8: expected.slice(0, 8),
    matches: session === expected,
  });

  if (!validateSession(session)) {
    throw redirect(302, '/admin/login');
  }

  return {};
};
