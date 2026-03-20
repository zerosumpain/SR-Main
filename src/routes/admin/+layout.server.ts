import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import crypto from 'crypto';
import type { LayoutServerLoad } from './$types';

function getSessionHash(password: string): string {
  return crypto.createHash('sha256').update(password + 'strange-ramblings-admin').digest('hex');
}

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  if (url.pathname === '/admin/login') return {};

  const session = cookies.get('admin_session');
  const expected = getSessionHash(env.ADMIN_PASSWORD || '');

  console.log('[admin guard]', {
    pathname: url.pathname,
    hasCookie: !!session,
    cookieLength: session?.length,
    matches: session === expected,
  });

  if (!session || session !== expected) {
    throw redirect(302, '/admin/login');
  }

  return {};
};
