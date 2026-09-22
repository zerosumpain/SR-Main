import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { withDevice } from '$lib/server/native-handler';

/**
 * PATCH /api/native/chat/conversations/[id] — rename or pin.
 * DELETE — remove the thread.
 *
 * A deliberately small slice of the web endpoint. That one also changes the
 * pinned model, the share visibility, the intel flag and the thinking level;
 * all four are desk decisions with consequences a phone cannot show — a share
 * visibility change mints a public link, and the model picker is locked after
 * the first message for reasons about price snapshots that no phone UI is going
 * to explain. Rename and pin are the two a thumb wants on a list, and they are
 * the two that are safe.
 *
 * DELETE is here even though it is destructive, because a thread list with no
 * way to clear the accidental one-word thread is a list that only grows. The
 * app puts it behind a long press and a confirmation rather than a swipe.
 */
export const PATCH: RequestHandler = withDevice(async ({ params, request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const payload = (body ?? {}) as { title?: unknown; pinned?: unknown };

  const set: { title?: string | null; pinned?: boolean } = {};
  if ('title' in payload) {
    const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 200) : '';
    set.title = title.length > 0 ? title : null;
  }
  if ('pinned' in payload) set.pinned = payload.pinned === true;

  if (Object.keys(set).length === 0) {
    return json({ error: 'Nothing to change.' }, { status: 400 });
  }

  const [row] = await db
    .update(conversations)
    .set(set)
    .where(eq(conversations.id, params.id))
    .returning({ id: conversations.id, title: conversations.title, pinned: conversations.pinned });

  if (!row) return json({ error: 'Conversation not found' }, { status: 404 });
  return { ok: true, id: row.id, title: row.title, pinned: row.pinned };
});

export const DELETE: RequestHandler = withDevice(async ({ params }) => {
  const [row] = await db
    .delete(conversations)
    .where(eq(conversations.id, params.id))
    .returning({ id: conversations.id });
  if (!row) return json({ error: 'Conversation not found' }, { status: 404 });
  return { ok: true, deleted: row.id };
});
