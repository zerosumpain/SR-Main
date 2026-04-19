import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createNote, processNote } from '$lib/jkai/intel/ingest';
import { saveBuffer } from '$lib/jkai/media/storage';
import { kindFromMime, extensionForMime, isAllowedMime } from '$lib/jkai/media/mime';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import type { JkaiAttachment } from '$lib/db/schema';

export const POST: RequestHandler = async ({ request }) => {
  const contentType = request.headers.get('content-type') ?? '';

  let title: string | undefined;
  let rawContent: string;
  let source: 'web' | 'whatsapp' | 'pwa' | 'email' = 'web';
  let format: 'text' | 'handwriting_scan' | 'audio_transcript' | 'email' | 'meeting_transcript' | 'summary' = 'text';
  let metadata: Record<string, unknown> = {};
  let attachment: JkaiAttachment | undefined;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    title = (form.get('title') as string) || undefined;
    rawContent = (form.get('content') as string) || '';
    source = (form.get('source') as any) || 'web';
    format = (form.get('format') as any) || 'text';

    const metaRaw = form.get('metadata') as string;
    if (metaRaw) {
      try { metadata = JSON.parse(metaRaw); } catch {}
    }

    const file = form.get('file');
    if (file instanceof File && file.size > 0) {
      const buf = Buffer.from(await file.arrayBuffer());
      const mime = file.type || 'application/octet-stream';

      if (!isAllowedMime(mime)) throw error(415, `Unsupported file type: ${mime}`);

      const ext = extensionForMime(mime);
      const { diskPath, sizeBytes } = await saveBuffer(buf, ext);
      const kind = kindFromMime(mime)!;

      const [att] = await db.insert(jkaiAttachments).values({
        source,
        kind,
        mimeType: mime,
        originalName: file.name.slice(0, 255),
        sizeBytes,
        diskPath,
        duration: null,
        metadata: null,
      }).returning();

      attachment = att;

      if (!rawContent) {
        rawContent = `[${kind} attachment: ${file.name}]`;
      }

      if (kind === 'image' && format === 'text') {
        format = 'handwriting_scan';
      } else if (kind === 'audio' && format === 'text') {
        format = 'audio_transcript';
      }
    }
  } else {
    const body = await request.json();
    title = body.title;
    rawContent = body.content || '';
    source = body.source || 'web';
    format = body.format || 'text';
    metadata = body.metadata || {};
  }

  if (!rawContent) throw error(400, 'content is required');

  const noteId = await createNote({ title, rawContent, source, format, metadata, attachment });

  processNote(noteId, attachment).catch((err) => {
    console.error(`[intel] Background processing failed for note ${noteId}:`, err);
  });

  return json({ id: noteId, status: 'pending' }, { status: 201 });
};
