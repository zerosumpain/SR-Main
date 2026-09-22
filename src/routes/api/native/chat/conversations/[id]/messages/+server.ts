import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { getConversationMessages } from '$lib/jkai/queries';
import { clampLimit, withDevice } from '$lib/server/native-handler';

/**
 * GET /api/native/chat/conversations/[id]/messages — one thread's history.
 *
 * Paged backwards from newest, same cursor contract as the web endpoint, so the
 * app scrolls up into older turns rather than loading a thread whole.
 *
 * The projection keeps `toolSteps` but only their labels and status, not their
 * arguments or results. A tool's arguments are the largest thing in a turn's
 * metadata and can carry file paths and query bodies; the phone renders one grey
 * line per step saying what ran and whether it worked, which is the whole of
 * what a transcript on a small screen can usefully say.
 */
export const GET: RequestHandler = withDevice(async ({ params, url }) => {
  const beforeRaw = url.searchParams.get('before');
  const beforeId = url.searchParams.get('beforeId');
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if ((beforeRaw || beforeId) && (!before || Number.isNaN(before.getTime()) || !beforeId)) {
    return json({ error: 'Invalid message cursor' }, { status: 400 });
  }

  const [conversation] = await db
    .select({ id: conversations.id, title: conversations.title, source: conversations.source })
    .from(conversations)
    .where(eq(conversations.id, params.id))
    .limit(1);
  if (!conversation) return json({ error: 'Conversation not found' }, { status: 404 });

  const history = await getConversationMessages(params.id, {
    limit: clampLimit(url.searchParams.get('limit'), 60, 200),
    cursor: before && beforeId ? { before, beforeId } : undefined,
  });

  return {
    conversation: {
      id: conversation.id,
      title: conversation.title,
      source: conversation.source,
    },
    hasOlder: history.hasOlder,
    cursor: history.cursor,
    messages: history.messages.map((message) => {
      const metadata = (message.metadata ?? {}) as Record<string, unknown>;
      const steps = Array.isArray(metadata.toolSteps) ? metadata.toolSteps : [];
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        // A WhatsApp turn reads differently from one typed on the web, and the
        // thread can hold both. The web endpoint stamps this per message off the
        // conversation's own source; so does this one.
        source: conversation.source === 'whatsapp' ? 'whatsapp' : 'web',
        toolSteps: steps.map((step) => {
          const entry = (step ?? {}) as Record<string, unknown>;
          return {
            tool: typeof entry.displayTool === 'string' ? entry.displayTool : entry.tool ?? null,
            status: entry.status ?? null,
            summary: typeof entry.summary === 'string' ? entry.summary : null,
          };
        }),
        attachments: message.attachments.map((attachment) => ({
          id: attachment.id,
          /** The column is `originalName`; it is nullable for a pasted blob. */
          filename: attachment.originalName,
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        })),
      };
    }),
  };
});
