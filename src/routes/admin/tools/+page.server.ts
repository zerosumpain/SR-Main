import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db
    .select({
      id: customTools.id,
      name: customTools.name,
      description: customTools.description,
      toolset: customTools.toolset,
      enabled: customTools.enabled,
      parameters: customTools.parameters,
      handlerCode: customTools.handlerCode,
      runCount: customTools.runCount,
      errorCount: customTools.errorCount,
      lastRunAt: customTools.lastRunAt,
      createdAt: customTools.createdAt,
    })
    .from(customTools)
    .orderBy(desc(customTools.createdAt));

  return { tools: rows };
};
