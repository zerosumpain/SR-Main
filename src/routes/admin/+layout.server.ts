import { redirect } from '@sveltejs/kit';
import { validateSession } from '$lib/auth';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  if (url.pathname === '/admin/login') return {};

  // Check cookie (try both with and without secure flag)
  const session = cookies.get('admin_session');
  if (validateSession(session)) {
    return {};
  }

  // Check URL token as fallback
  const token = url.searchParams.get('token');
  if (token && validateSession(token)) {
    // Set a fresh cookie for future requests
    cookies.set('admin_session', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });
    return {};
  }

  throw redirect(302, '/admin/login');
};
