import { json } from '@sveltejs/kit';
import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyRole } from '$lib/family/roster.server';
import type { RequestHandler } from './$types';

/** A household is a family; a pilot family holds a handful. */
const MAX_EMAILS = 50;

// Dedicated companion -> Main audience. Neither a phone credential nor the
// household export token is accepted here. No positive decision is cached.
//
// `?email=` asks for one person: `{ allowed, version }`. `?emails=` (repeated)
// asks for a whole household at once, `{ people: { <email>: { allowed,
// version } } }` — the pilot's household read used to make one call per
// member, every member, on every read. Each answer is read fresh either way.
export const GET: RequestHandler = async ({ request, url }) => {
  const expected = env.COMPANION_POLICY_TOKEN;
  const presented = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const headers = { 'cache-control': 'private, no-store' };
  if (!expected || expected.length < 32 || !timingSafeEqual(digest(expected), digest(presented))) {
    return json({ error: 'Not authorised' }, { status: 401, headers });
  }
  const norm = (e: string) => e.trim().toLowerCase();
  const keys = [...url.searchParams.keys()];
  const batch = keys.includes('emails');
  const emails = batch ? [...new Set(url.searchParams.getAll('emails').map(norm))] : [norm(url.searchParams.get('email') ?? '')];
  if (
    keys.some((k) => k !== (batch ? 'emails' : 'email')) ||
    emails.length > MAX_EMAILS ||
    emails.some((e) => !e || e.length > 320)
  ) {
    return json({ error: 'Invalid person' }, { status: 400, headers });
  }
  // Missing migration/database means 503, never a default permission version.
  try {
    const versions = await db.execute<{ email: string; version: string }>(sql`
      SELECT email, version::text AS version FROM companion_access_version
      WHERE email IN (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})`);
    const versionOf = new Map(versions.rows.map((r) => [r.email, r.version]));
    const roles = await Promise.all(emails.map((e) => familyRole(e)));
    const answer = (i: number) => ({ allowed: roles[i] !== null, version: versionOf.get(emails[i]) ?? '0' });
    if (!batch) return json(answer(0), { headers });
    return json({ people: Object.fromEntries(emails.map((e, i) => [e, answer(i)])) }, { headers });
  } catch {
    return json({ error: 'Access check unavailable' }, { status: 503, headers });
  }
};
