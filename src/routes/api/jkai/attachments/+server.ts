import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { fileTypeFromBuffer } from 'file-type';
import { saveBuffer } from '$lib/jkai/media/storage';
import { kindFromMime, extensionForMime, isAllowedMime } from '$lib/jkai/media/mime';

const LIMITS_BY_KIND: Record<string, number> = {
  image: 15 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  document: 2 * 1024 * 1024,
  text: 2 * 1024 * 1024,
};

function sanitizeFilename(name: string | null | undefined): string | null {
  if (!name) return null;
  const stripped = name.replace(/[\/\\\0]/g, '_');
  return stripped.slice(0, 255);
}

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData();
  const file = form.get('file');
  const conversationId = form.get('conversationId') as string | null;
  if (!(file instanceof File)) throw error(400, 'file is required');
  if (file.size === 0) throw error(400, 'file is empty');

  const buf = Buffer.from(await file.arrayBuffer());
  const sniffed = (await fileTypeFromBuffer(buf))?.mime;
  let mime = sniffed ?? file.type ?? 'application/octet-stream';

  if (!sniffed && file.type && file.type.startsWith('text/')) mime = file.type;
  else if (!sniffed && (file.type === 'application/json' || file.type === 'application/x-yaml')) mime = file.type;

  if (!isAllowedMime(mime)) throw error(415, `unsupported mime type: ${mime}`);

  const kind = kindFromMime(mime)!;
  const limit = LIMITS_BY_KIND[kind];
  if (file.size > limit) throw error(413, `file too large (${kind} limit: ${limit} bytes)`);

  const ext = extensionForMime(mime);
  const { diskPath, sizeBytes } = await saveBuffer(buf, ext);

  const [row] = await db.insert(jkaiAttachments).values({
    conversationId: conversationId || null,
    messageId: null,
    source: 'web',
    kind,
    mimeType: mime,
    originalName: sanitizeFilename(file.name),
    sizeBytes,
    diskPath,
    duration: null,
    metadata: null,
  }).returning();

  return json(row);
};
