import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import crypto from 'crypto';
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

  const hash = crypto
    .createHash('sha256')
    .update(password + 'strange-ramblings-admin')
    .digest('hex');

  cookies.set('admin_session', hash, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  return json({ success: true });
};
