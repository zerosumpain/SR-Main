import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { fileTypeFromBuffer } from 'file-type';
import { saveBuffer } from '$lib/jkai/media/storage';
import { kindFromMime, extensionForMime, isAllowedMime } from '$lib/jkai/media/mime';
import { mirrorJkaiAttachmentToDrive } from '$lib/file-index/jkai-mirror';

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

const ALLOWED_SOURCES = new Set(['web', 'generated']);

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData();
  const file = form.get('file');
  const conversationId = form.get('conversationId') as string | null;
  const sourceField = (form.get('source') as string | null) || 'web';
  // Hermes plugin uploads agent-produced screenshots / image-gen output with
  // `source=generated` so the chat UI can label them and rate-limits in
  // `$lib/jkai/media/rate-limits` keep tracking them. Anything else falls back
  // to `web` (the original user-upload semantics).
  const source: 'web' | 'generated' = ALLOWED_SOURCES.has(sourceField)
    ? (sourceField as 'web' | 'generated')
    : 'web';
  if (!(file instanceof File)) throw error(400, 'file is required');
  if (file.size === 0) throw error(400, 'file is empty');

  const buf = Buffer.from(await file.arrayBuffer());
  const sniffed = (await fileTypeFromBuffer(buf))?.mime;
  let mime = sniffed ?? file.type ?? 'application/octet-stream';

  if (!sniffed && file.type && file.type.startsWith('text/')) mime = file.type;
  else if (!sniffed && (file.type === 'application/json' || file.type === 'application/x-yaml')) mime = file.type;

  // `file-type` reports Opus-in-Ogg with a codec parameter (`audio/ogg;
  // codecs=opus`) which doesn't match the bare-MIME allowlist. Strip any
  // RFC 6838 parameters (everything after the first `;`) before lookup —
  // the kind/extension tables only key on the canonical type/subtype.
  const baseMime = mime.split(';', 1)[0].trim();
  if (!isAllowedMime(baseMime)) throw error(415, `unsupported mime type: ${mime}`);
  mime = baseMime;

  const kind = kindFromMime(mime)!;
  const limit = LIMITS_BY_KIND[kind];
  if (file.size > limit) throw error(413, `file too large (${kind} limit: ${limit} bytes)`);

  const ext = extensionForMime(mime);
  const { diskPath, sizeBytes } = await saveBuffer(buf, ext);

  const [row] = await db.insert(jkaiAttachments).values({
    conversationId: conversationId || null,
    messageId: null,
    source,
    kind,
    mimeType: mime,
    originalName: sanitizeFilename(file.name),
    sizeBytes,
    diskPath,
    duration: null,
    metadata: null,
  }).returning();

  // Mirror everything the chat touches into /drive under `jkai/<chat title>/`
  // and embed it, so chat files are browsable in /drive and searchable via
  // @files. Agent-generated output (screenshots, write_document results) is
  // included: it is as much a file "in the chat" as an upload, and leaving it
  // out meant the only copy lived in the jkai media store.
  // Best-effort — never blocks or fails the upload.
  void mirrorJkaiAttachmentToDrive({
    buf,
    originalName: file.name,
    mimeType: mime,
    conversationId,
    source,
  });

  return json(row);
};
