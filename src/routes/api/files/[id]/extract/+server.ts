// src/routes/api/files/[id]/extract/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { extractText, ExtractError } from '$lib/jkai/extract';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const id = params.id;
  if (!id) return json({ error: 'id required' }, { status: 400 });
  const [row] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, id));
  if (!row) return json({ error: 'file not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const language = typeof body.language === 'string' ? body.language : undefined;

  const session = await locals.auth();
  const uploadedBy = session?.user?.email ?? row.uploadedBy ?? null;

  let result;
  try {
    const buf = await readBuffer(row.diskPath);
    result = await extractText(buf, row.mimeType, row.name, { language });
  } catch (err) {
    if (err instanceof ExtractError) {
      const status = err.code === 'E_UNSUPPORTED_MIME' || err.code === 'E_INVALID_INPUT' ? 415 : 500;
      return json({ error: err.message, code: err.code }, { status });
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  const txtName = `${row.name}.extracted.txt`;
  const jsonName = `${row.name}.extracted.json`;

  const txtBuf = Buffer.from(result.text, 'utf8');
  const jsonBuf = Buffer.from(JSON.stringify(result, null, 2), 'utf8');

  const derivedFiles = [
    await upsertFile(txtName, txtBuf, 'text/plain', uploadedBy),
    await upsertFile(jsonName, jsonBuf, 'application/json', uploadedBy),
  ];

  return json({
    text: result.text,
    meta: result.meta,
    derivedFiles,
  });
};

async function upsertFile(name: string, buffer: Buffer, mimeType: string, uploadedBy: string | null) {
  const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, name));
  if (existing) {
    await saveBuffer(existing.diskPath, buffer);
    const [updated] = await db.update(workflowFiles)
      .set({ sizeBytes: buffer.byteLength, mimeType, updatedAt: new Date() })
      .where(eq(workflowFiles.id, existing.id))
      .returning();
    return summary(updated);
  }
  const diskPath = newDiskPath(name);
  await saveBuffer(diskPath, buffer);
  const [inserted] = await db.insert(workflowFiles).values({
    name,
    mimeType,
    sizeBytes: buffer.byteLength,
    diskPath,
    permissions: { read: true, write: true, append: false, delete: true },
    uploadedBy,
  }).returning();
  return summary(inserted);
}

function summary(row: typeof workflowFiles.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt,
  };
}
