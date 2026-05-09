import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { webdavCredentials } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// Revoke = soft delete. The credential row is kept for audit trail; the
// hooks.server.ts auth lookup filters on revoked_at IS NULL.
export const DELETE: RequestHandler = async ({ params }) => {
  const id = params.id;
  if (!id) return json({ error: 'id required' }, { status: 400 });
  await db
    .update(webdavCredentials)
    .set({ revokedAt: new Date() })
    .where(eq(webdavCredentials.id, id));
  return json({ ok: true });
};
