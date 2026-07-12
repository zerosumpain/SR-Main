// Owner-only (hooks gate, same as ../import): the editor's DRIVE tab.
// GET lists /drive files whose type a deck block can carry (images + mp4/webm);
// POST copies one into the public deck-media bucket — deck slides must never
// serve from the owner-gated drive store, so inclusion is always a copy, the
// same posture as provider imports.

import { json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { storeUpload } from '$lib/decks/image-sources.server';
import { readBuffer } from '$lib/file-store/storage';
import type { RequestHandler } from './$types';

const COMPAT_MIME: Record<string, 'image' | 'video'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
};

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/** Effective mime — stored mimeType first, extension as the fallback (older
 *  rows sometimes carry application/octet-stream). */
function effectiveMime(name: string, mimeType: string | null): string | null {
  const stored = (mimeType ?? '').split(';')[0].trim();
  if (COMPAT_MIME[stored]) return stored;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? null;
}

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(workflowFiles).orderBy(desc(workflowFiles.updatedAt));
  const files = rows.flatMap((r) => {
    const mime = effectiveMime(r.name, r.mimeType);
    if (!mime || !COMPAT_MIME[mime]) return [];
    return [{
      id: r.id,
      name: r.name,
      sizeBytes: r.sizeBytes,
      kind: COMPAT_MIME[mime],
      // Editor-only preview URL (owner-gated like everything under /api/files).
      previewUrl: `/api/files/${r.id}/download?inline=1`,
    }];
  });
  return json({ ok: true, files });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { fileId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.fileId !== 'string' || !body.fileId) {
    return json({ error: 'fileId required' }, { status: 400 });
  }

  const [row] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, body.fileId));
  if (!row) return json({ error: 'Unknown file' }, { status: 404 });
  const mime = effectiveMime(row.name, row.mimeType);
  if (!mime) return json({ error: `"${row.name}" is not a deck-compatible image or video` }, { status: 400 });

  let buf: Buffer;
  try {
    buf = await readBuffer(row.diskPath);
  } catch {
    return json({ error: 'file content missing from the drive store' }, { status: 410 });
  }
  try {
    const stored = await storeUpload(buf, mime, row.name);
    return json({ ok: true, ...stored });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'import failed' }, { status: 400 });
  }
};
