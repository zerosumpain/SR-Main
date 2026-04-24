import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles, type WorkflowFilePermissions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { deleteFile } from '$lib/file-store/storage';

function mergePerms(existing: unknown, patch: Partial<WorkflowFilePermissions>): WorkflowFilePermissions {
  const e = (existing ?? {}) as Partial<WorkflowFilePermissions>;
  return {
    read: patch.read !== undefined ? !!patch.read : e.read !== false,
    write: patch.write !== undefined ? !!patch.write : !!e.write,
    append: patch.append !== undefined ? !!patch.append : !!e.append,
    delete: patch.delete !== undefined ? !!patch.delete : !!e.delete,
  };
}

export const GET: RequestHandler = async ({ params }) => {
  const [row] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, params.id));
  if (!row) throw error(404, 'file not found');
  return json({ file: row });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, params.id));
  if (!existing) throw error(404, 'file not found');

  const updates: Partial<typeof workflowFiles.$inferInsert> = { updatedAt: new Date() };

  if (typeof body.name === 'string' && body.name.trim()) {
    const newName = body.name.trim().replace(/^\/+/, '').slice(0, 200);
    if (newName !== existing.name) {
      const [clash] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, newName));
      if (clash) return json({ error: 'name already in use' }, { status: 409 });
      updates.name = newName;
    }
  }

  if (typeof body.description === 'string' || body.description === null) {
    updates.description = body.description === null ? null : String(body.description).slice(0, 1000);
  }

  if (body.permissions && typeof body.permissions === 'object') {
    updates.permissions = mergePerms(existing.permissions, body.permissions);
  }

  const [updated] = await db
    .update(workflowFiles)
    .set(updates)
    .where(eq(workflowFiles.id, params.id))
    .returning();

  return json({ file: updated });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, params.id));
  if (!existing) throw error(404, 'file not found');
  await deleteFile(existing.diskPath);
  await db.delete(workflowFiles).where(eq(workflowFiles.id, params.id));
  return json({ ok: true });
};
