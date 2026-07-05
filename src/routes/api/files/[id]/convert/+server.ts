// src/routes/api/files/[id]/convert/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, saveBuffer, newDiskPath } from '$lib/file-store/storage';
import { synthesize, ExtractError, type SynthesizeFormat, type SynthesizeSource } from '$lib/jkai/extract';
import { reindexFileInBackground } from '$lib/file-index/store';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const id = params.id;
  if (!id) return json({ error: 'id required' }, { status: 400 });
  const [row] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, id));
  if (!row) return json({ error: 'file not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const source = body.source as SynthesizeSource;
  const format = body.format as SynthesizeFormat;
  const outputName = typeof body.outputName === 'string' ? body.outputName : null;
  const title = typeof body.title === 'string' ? body.title : undefined;
  if (!source || !format) return json({ error: 'source and format required' }, { status: 400 });

  const session = await locals.auth();
  const uploadedBy = session?.user?.email ?? row.uploadedBy ?? null;

  try {
    const buf = await readBuffer(row.diskPath);
    const content: string | Buffer = source === 'xlsx' ? buf : buf.toString('utf8');
    const result = await synthesize({ source, format, content, title });

    const name = outputName?.trim() || `${row.name}${result.suggestedExtension}`;
    const file = await upsertFile(name, result.buffer, result.mimeType, uploadedBy);
    reindexFileInBackground(file.id);
    return json({ file });
  } catch (err) {
    if (err instanceof ExtractError) {
      const status = err.code === 'E_INVALID_INPUT' || err.code === 'E_UNSUPPORTED_MIME' ? 415 : 500;
      return json({ error: err.message, code: err.code }, { status });
    }
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
};

async function upsertFile(name: string, buffer: Buffer, mimeType: string, uploadedBy: string | null) {
  const cleanName = name.replace(/^\/+/, '').slice(0, 200);
  const [existing] = await db.select().from(workflowFiles).where(eq(workflowFiles.name, cleanName));
  if (existing) {
    await saveBuffer(existing.diskPath, buffer);
    const [updated] = await db.update(workflowFiles)
      .set({ sizeBytes: buffer.byteLength, mimeType, updatedAt: new Date() })
      .where(eq(workflowFiles.id, existing.id))
      .returning();
    return summary(updated);
  }
  const diskPath = newDiskPath(cleanName);
  await saveBuffer(diskPath, buffer);
  const [inserted] = await db.insert(workflowFiles).values({
    name: cleanName,
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
