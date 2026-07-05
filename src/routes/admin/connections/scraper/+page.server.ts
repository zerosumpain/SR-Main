import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { scraperCredentials, scraperRunLog, scraperTargetKnowledge } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const creds = await db.select({
    id: scraperCredentials.id,
    domain: scraperCredentials.domain,
    label: scraperCredentials.label,
    loginStrategy: scraperCredentials.loginStrategy,
    loginUrl: scraperCredentials.loginUrl,
    createdAt: scraperCredentials.createdAt,
  }).from(scraperCredentials);
  const recent = await db.select().from(scraperRunLog).orderBy(desc(scraperRunLog.id)).limit(50);
  const targetKnowledge = await db.select().from(scraperTargetKnowledge).orderBy(desc(scraperTargetKnowledge.updatedAt));
  return { credentials: creds, recentRuns: recent, targetKnowledge };
};
