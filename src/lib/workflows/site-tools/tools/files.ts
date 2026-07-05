import { register } from '../registry-internal';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { eq, like, desc } from 'drizzle-orm';
import { readBuffer } from '$lib/file-store/storage';
import { extractText, ExtractError, kindFromMime } from '$lib/jkai/extract';

const MAX_INLINE_TEXT_BYTES = 200 * 1024;

register({
  name: 'file_list',
  description:
    'List files in the workflow file store (uploaded via /admin/connections/files). Returns id, name, mimeType, sizeBytes, description, and updatedAt for each. Use file_read to read a specific file by id or name.',
  parameters: {
    type: 'object',
    properties: {
      prefix: { type: 'string', description: 'Optional name prefix filter, e.g. "reports/"' },
      limit: { type: 'number', description: 'Max rows to return (default 50, max 200)' },
    },
  },
  category: 'Files',
  toolset: 'files',
  handler: async (args) => {
    const prefix = typeof args.prefix === 'string' ? args.prefix : '';
    const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);
    const base = db.select({
      id: workflowFiles.id,
      name: workflowFiles.name,
      mimeType: workflowFiles.mimeType,
      sizeBytes: workflowFiles.sizeBytes,
      description: workflowFiles.description,
      updatedAt: workflowFiles.updatedAt,
    }).from(workflowFiles);
    const rows = prefix
      ? await base.where(like(workflowFiles.name, `${prefix}%`)).orderBy(desc(workflowFiles.updatedAt)).limit(limit)
      : await base.orderBy(desc(workflowFiles.updatedAt)).limit(limit);
    return { success: true, data: { files: rows, count: rows.length } };
  },
});

register({
  name: 'file_read',
  description:
    'Read a file from the workflow file store and return its text content. For text/markdown/json/csv files the raw bytes are returned as utf-8. For PDF/DOCX/audio/video files the file is automatically extracted (PDFs parsed page-by-page, audio/video transcribed via Whisper). Returns { name, mimeType, sizeBytes, kind, text, meta? }. Look up files first with file_list. Specify the file by id (preferred) or by name.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'File id from file_list (preferred — unambiguous)' },
      name: { type: 'string', description: 'File name (alternative to id)' },
      maxBytes: { type: 'number', description: `Truncate the returned text after this many bytes (default ${MAX_INLINE_TEXT_BYTES}). Useful for large files.` },
    },
  },
  category: 'Files',
  toolset: 'files',
  handler: async (args) => {
    const id = typeof args.id === 'string' ? args.id : null;
    const name = typeof args.name === 'string' ? args.name : null;
    if (!id && !name) return { success: false, error: 'either id or name is required' };

    const [row] = id
      ? await db.select().from(workflowFiles).where(eq(workflowFiles.id, id))
      : await db.select().from(workflowFiles).where(eq(workflowFiles.name, name as string));
    if (!row) return { success: false, error: 'file not found' };

    const perms = (row.permissions ?? {}) as { read?: boolean };
    if (perms.read === false) return { success: false, error: `read permission denied on ${row.name}` };

    const buf = await readBuffer(row.diskPath);
    const kind = kindFromMime(row.mimeType, row.name);
    const maxBytes = Math.max(Number(args.maxBytes) || MAX_INLINE_TEXT_BYTES, 1024);

    let text: string;
    let meta: unknown = undefined;

    if (kind === 'text' || kind === 'markdown') {
      text = buf.toString('utf8');
    } else if (kind) {
      try {
        const result = await extractText(buf, row.mimeType, row.name);
        text = result.text;
        meta = result.meta;
      } catch (err) {
        if (err instanceof ExtractError) {
          return { success: false, error: `extract failed (${err.code}): ${err.message}` };
        }
        throw err;
      }
    } else {
      return { success: false, error: `cannot read file with mime ${row.mimeType} — no extractor available` };
    }

    let truncated = false;
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      let cut = text.length;
      while (cut > 0 && Buffer.byteLength(text.slice(0, cut), 'utf8') > maxBytes) cut -= 1024;
      text = text.slice(0, cut) + '\n\n[…truncated]';
      truncated = true;
    }

    return {
      success: true,
      data: {
        id: row.id,
        name: row.name,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        kind,
        text,
        meta,
        truncated,
      },
    };
  },
});
