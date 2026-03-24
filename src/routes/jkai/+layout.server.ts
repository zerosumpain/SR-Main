import { redirect } from '@sveltejs/kit';
import { validateSession, getExpectedHash } from '$lib/auth';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  const session = cookies.get('admin_session');
  const token = url.searchParams.get('token');

  if (validateSession(session)) {
    return { adminToken: session };
  }

  if (token && validateSession(token)) {
    cookies.set('admin_session', token, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });
    return { adminToken: token };
  }

  const redirectTo = url.pathname + url.search;
  throw redirect(302, `/admin/login?redirectTo=${encodeURIComponent(redirectTo)}`);
};
