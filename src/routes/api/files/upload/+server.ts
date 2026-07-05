import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles, type WorkflowFilePermissions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { newDiskPath, saveBuffer, deleteFile } from '$lib/file-store/storage';
import { reindexFileInBackground } from '$lib/file-index/store';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per file — plenty for text / csv / images

function parsePerms(raw: unknown): WorkflowFilePermissions {
  let parsed: Partial<WorkflowFilePermissions> | null = null;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as Partial<WorkflowFilePermissions>;
  }
  return {
    read: parsed?.read !== false,
    write: !!parsed?.write,
    append: !!parsed?.append,
    delete: !!parsed?.delete,
  };
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return json({ error: 'file field required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return json({ error: `file too large (> ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` }, { status: 413 });
  }

  const rawName = (form.get('name') as string | null)?.trim() || file.name || 'untitled';
  const name = rawName.replace(/^\/+/, '').slice(0, 200);
  const description = ((form.get('description') as string | null) || '').slice(0, 1000) || null;
  const permissions = parsePerms(form.get('permissions'));

  const existing = await db.select().from(workflowFiles).where(eq(workflowFiles.name, name));
  if (existing.length > 0) {
    return json({ error: `file with name "${name}" already exists` }, { status: 409 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const diskPath = newDiskPath(name);
  try {
    await saveBuffer(diskPath, buf);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `save failed: ${msg}` }, { status: 500 });
  }

  const session = await locals.auth();
  const uploadedBy = session?.user?.email ?? null;

  let inserted: typeof workflowFiles.$inferSelect | undefined;
  try {
    [inserted] = await db
      .insert(workflowFiles)
      .values({
        name,
        description,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: buf.byteLength,
        diskPath,
        permissions,
        uploadedBy,
      })
      .returning();
  } catch (err: unknown) {
    // The line-40 existence check is not atomic; a concurrent upload of the same
    // name races here. Catch the UNIQUE violation, remove the orphaned blob we
    // just wrote, and return the same clean 409 as the sequential path.
    await deleteFile(diskPath).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    if (/workflow_files_name_idx|unique|duplicate key|23505/i.test(msg)) {
      return json({ error: `file with name "${name}" already exists` }, { status: 409 });
    }
    return json({ error: `insert failed: ${msg}` }, { status: 500 });
  }
  if (!inserted) {
    await deleteFile(diskPath).catch(() => {});
    return json({ error: 'insert failed' }, { status: 500 });
  }

  // Auto-embed the new file's content into the global @files index (background;
  // hash-gated + idempotent, so it never blocks the upload response).
  reindexFileInBackground(inserted.id);

  return json({
    file: {
      id: inserted.id,
      name: inserted.name,
      description: inserted.description,
      mimeType: inserted.mimeType,
      sizeBytes: inserted.sizeBytes,
      permissions: inserted.permissions,
      uploadedBy: inserted.uploadedBy,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    },
  });
};

