import { redirect, fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import crypto from 'crypto';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData();
    const password = data.get('password') as string;

    if (!password || password !== env.ADMIN_PASSWORD) {
      return fail(401, { error: 'Invalid password' });
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
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    throw redirect(302, '/admin');
  },
};
