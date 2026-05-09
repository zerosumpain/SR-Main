import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { webdavCredentials } from '$lib/db/schema';
import { isNull, desc } from 'drizzle-orm';
import { generateSecret, hashSecret } from '$lib/webdav/auth';

// List all unrevoked credentials. Secret hashes never leave the DB.
export const GET: RequestHandler = async () => {
  const rows = await db
    .select({
      id: webdavCredentials.id,
      label: webdavCredentials.label,
      ownerEmail: webdavCredentials.ownerEmail,
      lastUsedAt: webdavCredentials.lastUsedAt,
      createdAt: webdavCredentials.createdAt,
    })
    .from(webdavCredentials)
    .where(isNull(webdavCredentials.revokedAt))
    .orderBy(desc(webdavCredentials.createdAt));
  return json({ credentials: rows });
};

// Create a new credential. Returns the secret exactly once — caller must
// copy it now or revoke and recreate.
export const POST: RequestHandler = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const label = (body?.label as string | undefined)?.trim();
  if (!label) return json({ error: 'label required' }, { status: 400 });
  if (label.length > 64) return json({ error: 'label too long' }, { status: 400 });

  const session = await locals.auth();
  const ownerEmail = session?.user?.email ?? 'unknown';

  const secret = generateSecret();
  const [row] = await db
    .insert(webdavCredentials)
    .values({
      label,
      secretHash: hashSecret(secret),
      ownerEmail,
    })
    .returning({ id: webdavCredentials.id, label: webdavCredentials.label, createdAt: webdavCredentials.createdAt });

  return json({ id: row.id, label: row.label, createdAt: row.createdAt, secret });
};
