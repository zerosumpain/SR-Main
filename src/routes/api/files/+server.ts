import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(workflowFiles).orderBy(desc(workflowFiles.updatedAt));
  return json({
    files: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      permissions: r.permissions,
      uploadedBy: r.uploadedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
};
