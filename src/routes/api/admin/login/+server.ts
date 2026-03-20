import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import crypto from 'crypto';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const { password } = await request.json();

  if (!password || password !== env.ADMIN_PASSWORD) {
    throw error(401, JSON.stringify({ error: 'Invalid password' }));
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
