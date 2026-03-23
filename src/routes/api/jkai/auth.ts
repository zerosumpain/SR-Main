import { validateSession } from '$lib/auth';
import type { Cookies } from '@sveltejs/kit';

export function authorize(cookies: Cookies, url: URL): boolean {
  const session = cookies.get('admin_session');
  const token = url.searchParams.get('token');
  return validateSession(session) || validateSession(token ?? undefined);
}
