import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { projectVisibility } from '$lib/db/schema';
import { getAllowedProjectKeys } from '$lib/projects/registry';
import { purgeProjectCdn } from '$lib/projects/cdn-purge';

// Auth is enforced by the hook (401 for /api/* when unauthed; bypassed on the
// homeserv LAN), so this handler mirrors the existing unpublish endpoint and
// does not re-check the session.
export const POST: RequestHandler = async ({ request }) => {
  let body: { key?: unknown; isPublic?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const key = typeof body.key === 'string' ? body.key : '';
  const isPublic = body.isPublic === true;
  if (!key) return json({ error: 'Missing key' }, { status: 400 });

  const allowed = await getAllowedProjectKeys();
  if (!allowed.has(key)) return json({ error: 'Unknown project key' }, { status: 400 });

  await db
    .insert(projectVisibility)
    .values({ projectKey: key, isPublic, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: projectVisibility.projectKey,
      set: { isPublic, updatedAt: new Date() },
    });

  // Going private: clear the stale-public copies from Cloudflare's edge so the
  // origin's 404 takes effect immediately (no-op when CF creds are unset).
  let purged = 0;
  if (!isPublic) {
    ({ purged } = await purgeProjectCdn(key));
  }

  return json({ ok: true, key, isPublic, purged });
};
