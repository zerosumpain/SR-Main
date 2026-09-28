import { json } from '@sveltejs/kit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyRole } from '$lib/family/roster.server';
import type { RequestHandler } from './$types';

// Dedicated companion -> Main audience. Neither a phone credential nor the
// household export token is accepted here. No positive decision is cached.
export const GET: RequestHandler = async ({ request, url }) => {
  const expected = env.COMPANION_POLICY_TOKEN;
  const presented = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const headers = { 'cache-control': 'private, no-store' };
  if (!expected || expected.length < 32 || !timingSafeEqual(digest(expected), digest(presented))) {
    return json({ error: 'Not authorised' }, { status: 401, headers });
  }
  const email = url.searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!email || email.length > 320 || [...url.searchParams.keys()].some(k => k !== 'email')) {
    return json({ error: 'Invalid person' }, { status: 400, headers });
  }
  // Missing migration/database means 503, never a default permission version.
  try {
    const version = await db.execute<{ version: string }>(sql`
      SELECT coalesce((SELECT version::text FROM companion_access_version WHERE email=${email}), '0') AS version`);
    const role = await familyRole(email);
    return json({ allowed: role !== null, version: version.rows[0].version }, { headers });
  } catch {
    return json({ error: 'Access check unavailable' }, { status: 503, headers });
  }
};
