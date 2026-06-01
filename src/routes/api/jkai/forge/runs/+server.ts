import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

// Owner allowlist — mirrors getAllowedEmails() in src/hooks.server.ts and
// /api/auth/me.
function allowedEmails(): string[] {
  return (env.AUTH_ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * GET /api/jkai/forge/runs — owner-gated. Lists Forge builds (origin='forge')
 * with id, status, createdAt, and the PR/branch URL (stored in publishedSlug
 * when a git-target build completes).
 */
export const GET: RequestHandler = async ({ locals }) => {
  const session = await locals.auth();
  const email = (session?.user?.email || '').toLowerCase();
  const isOwner = !!email && allowedEmails().includes(email);
  if (!isOwner) {
    return json({ error: 'forbidden' }, { status: 403 });
  }

  const rows = await db
    .select({
      id: jkaiBuilds.id,
      title: jkaiBuilds.title,
      status: jkaiBuilds.status,
      createdAt: jkaiBuilds.createdAt,
      updatedAt: jkaiBuilds.updatedAt,
      prUrl: jkaiBuilds.publishedSlug,
    })
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.origin, 'forge'))
    .orderBy(desc(jkaiBuilds.createdAt));

  return json(rows);
};
