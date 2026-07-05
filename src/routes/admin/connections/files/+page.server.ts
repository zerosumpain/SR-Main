import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { workflowFiles, webdavCredentials } from '$lib/db/schema';
import { desc, isNull } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const [files, credentials] = await Promise.all([
    db.select().from(workflowFiles).orderBy(desc(workflowFiles.updatedAt)),
    db
      .select({
        id: webdavCredentials.id,
        label: webdavCredentials.label,
        ownerEmail: webdavCredentials.ownerEmail,
        lastUsedAt: webdavCredentials.lastUsedAt,
        createdAt: webdavCredentials.createdAt,
      })
      .from(webdavCredentials)
      .where(isNull(webdavCredentials.revokedAt))
      .orderBy(desc(webdavCredentials.createdAt)),
  ]);
  return { files, credentials };
};
