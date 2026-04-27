// src/lib/workflows/site-tools/tools/media-write-document.ts
// Generation tool: write text content (markdown, code, CSV, JSON, plain text) as a
// downloadable attachment linked to the conversation.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { saveBuffer } from '$lib/jkai/media/storage';
import { extensionForMime } from '$lib/jkai/media/mime';

const FORMAT_MIME: Record<string, { mime: string; kind: 'text' | 'document' }> = {
  markdown: { mime: 'text/markdown', kind: 'text' },
  text: { mime: 'text/plain', kind: 'text' },
  csv: { mime: 'text/csv', kind: 'text' },
  json: { mime: 'application/json', kind: 'text' },
  code: { mime: 'text/plain', kind: 'text' },
};

const EXT_FALLBACK: Record<string, string> = {
  md: 'markdown', markdown: 'markdown',
  txt: 'text', log: 'text',
  csv: 'csv', tsv: 'csv',
  json: 'json',
  ts: 'code', js: 'code', py: 'code', go: 'code', rs: 'code',
  c: 'code', cpp: 'code', sh: 'code',
};

function sanitizeFilename(name: string): string | null {
  if (!name || name.length > 255) return null;
  if (/[\/\\\0]/.test(name)) return null;
  if (name.startsWith('.')) return null;
  return name;
}

export async function handleWriteDocument(
  args: {
    filename: string;
    content: string;
    format?: 'markdown' | 'text' | 'csv' | 'json' | 'code';
    conversation_id?: string;
  },
  ctx?: { conversationId?: string | null; messageId?: string | null },
): Promise<ToolResult & { attachments?: any[] }> {
  const clean = sanitizeFilename(args.filename);
  if (!clean) return { success: false, error: 'Invalid filename — must not contain path separators, start with a dot, or exceed 255 characters.' };

  const ext = (clean.split('.').pop() ?? '').toLowerCase();
  const format = args.format ?? EXT_FALLBACK[ext] ?? 'text';
  const { mime, kind } = FORMAT_MIME[format] ?? FORMAT_MIME.text;

  if (typeof args.content !== 'string') return { success: false, error: 'content must be a string' };
  if (args.content.length > 2 * 1024 * 1024) return { success: false, error: 'content exceeds 2MB limit' };

  const buf = Buffer.from(args.content, 'utf8');
  const { diskPath, sizeBytes } = await saveBuffer(buf, extensionForMime(mime));

  const conversationId = ctx?.conversationId ?? args.conversation_id ?? null;
  const messageId = ctx?.messageId ?? null;

  const [row] = await db.insert(jkaiAttachments).values({
    conversationId,
    messageId,
    source: 'generated',
    kind,
    mimeType: mime,
    originalName: clean,
    sizeBytes,
    diskPath,
    duration: null,
    metadata: { format },
  }).returning();

  return {
    success: true,
    data: {
      attachmentId: row.id,
      filename: clean,
      mimeType: mime,
      sizeBytes,
      kind,
    },
    attachments: [row],
  };
}

register({
  name: 'write_document',
  description:
    'Save text content (markdown, code, CSV, JSON, plain text) as a downloadable file attached to the conversation. Use for reports, exports, code snippets, and anything the user might want to reuse or share as a file.',
  toolset: 'media',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Filename with extension, no path separators (e.g. "report.md").' },
      content: { type: 'string', description: 'File contents (UTF-8, max 2MB).' },
      format: {
        type: 'string',
        enum: ['markdown', 'text', 'csv', 'json', 'code'],
        description: 'Optional; inferred from extension when omitted.',
      },
      conversation_id: { type: 'string', description: 'Conversation ID to attach the file to. Usually injected automatically.' },
    },
    required: ['filename', 'content'],
  },
  handler: async (args, ctx) => {
    return handleWriteDocument(args as any, ctx ?? undefined);
  },
});
