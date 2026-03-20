import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createSessionCookie } from '$lib/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  const password = body?.password;

  if (!password || !env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: 'Invalid password' }, { status: 401 });
  }

  const hash = createSessionCookie(password);

  // Delete any old secure cookies, set new one without secure flag
  cookies.delete('admin_session', { path: '/', secure: true });
  cookies.delete('admin_session', { path: '/' });

  cookies.set('admin_session', hash, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  // Return the token so client can use it as URL fallback
  return json({ success: true, token: hash });
};
