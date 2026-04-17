// src/routes/api/jkai/tools/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(customTools).orderBy(desc(customTools.createdAt));
  // Strip handler code — this endpoint is for display, not for exposing
  // executable source to the browser.
  const tools = rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    toolset: r.toolset,
    enabled: r.enabled,
    runCount: r.runCount,
    errorCount: r.errorCount,
    lastRunAt: r.lastRunAt,
    createdAt: r.createdAt,
  }));
  return json({ tools });
};
