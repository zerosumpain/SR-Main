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
    console.log('[login] failed', { passwordLength: password?.length, envLength: env.ADMIN_PASSWORD?.length });
    return json({ error: 'Invalid password' }, { status: 401 });
  }

  const hash = createSessionCookie(password);
  console.log('[login] success, hash starts:', hash.slice(0, 8));

  // Clear any stale cookie first
  cookies.delete('admin_session', { path: '/' });

  // Set fresh cookie — try without secure flag (Cloudflare handles HTTPS)
  cookies.set('admin_session', hash, {
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  return json({ success: true });
};
