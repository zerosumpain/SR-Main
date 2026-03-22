import { redirect } from '@sveltejs/kit';
import { validateSession, getExpectedHash } from '$lib/auth';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  if (url.pathname === '/admin/login') return {};

  const session = cookies.get('admin_session');
  const token = url.searchParams.get('token');

  // Try cookie first
  if (validateSession(session)) {
    return { adminToken: session };
  }

  // Try URL token
  if (token && validateSession(token)) {
    // Try to set cookie for future requests
    cookies.set('admin_session', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });
    return { adminToken: token };
  }

  const redirectTo = url.pathname + url.search;
  throw redirect(302, `/admin/login?redirectTo=${encodeURIComponent(redirectTo)}`);
};
