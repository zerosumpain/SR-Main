import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import crypto from 'crypto';
import { syncAll } from '$lib/health/sync-service';
import type { RequestHandler } from './$types';

function isValidSession(cookies: any): boolean {
  const session = cookies.get('admin_session');
  if (!session || !env.ADMIN_PASSWORD) return false;
  const expected = crypto.createHash('sha256').update(env.ADMIN_PASSWORD + 'strange-ramblings-admin').digest('hex');
  return session === expected;
}

export const POST: RequestHandler = async ({ request, cookies }) => {
  if (!isValidSession(cookies)) {
    throw error(401, 'Unauthorized');
  }

  const body = await request.json().catch(() => ({}));
  const fullBackfill = body.fullBackfill === true;

  const result = await syncAll({ fullBackfill, maxPages: fullBackfill ? 20 : 1 });
  return json(result);
};
