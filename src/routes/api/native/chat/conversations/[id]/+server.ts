import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { withDevice } from '$lib/server/native-handler';
import { isThinkingLevel } from '$lib/models/thinking';
import { setDefaultThinkingLevel } from '$lib/server/models/settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';

/**
 * PATCH /api/native/chat/conversations/[id] — rename, pin, thinking level, model.
 * DELETE — remove the thread.
 *
 * A slice of the web endpoint. Share visibility and the intel flag stay off the
 * phone: a share change mints a public link, which is a desk decision with a
 * consequence a phone cannot show.
 *
 * The model and thinking level were left off at first, on the grounds that the
 * model lock was a price-snapshot rule no phone UI would explain. The app now
 * says so in plain words (the thread menu reads "Locked after the first
 * message"), and this applies the SAME rule the web does: a model change on a
 * thread with any message is a 409, and a change before one takes the price
 * snapshot. The list the phone chooses from is
 * `GET /api/native/chat/conversations/[id]/model`.
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
  const payload = (body ?? {}) as {
    title?: unknown;
    pinned?: unknown;
    thinkingLevel?: unknown;
    modelProvider?: unknown;
    modelId?: unknown;
  };

  if ('modelProvider' in payload || 'modelId' in payload) {
    return changeModel(params.id, payload.modelProvider, payload.modelId);
  }

  const set: { title?: string | null; pinned?: boolean; thinkingLevel?: string | null } = {};
  if ('thinkingLevel' in payload) {
    // As on the web: anything that is not a known level means "back to the
    // provider default", and the pick becomes the default for the next thread.
    const level = isThinkingLevel(payload.thinkingLevel) ? payload.thinkingLevel : null;
    set.thinkingLevel = level;
    await setDefaultThinkingLevel(level).catch(() => {});
  }
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
    .returning({
      id: conversations.id,
      title: conversations.title,
      pinned: conversations.pinned,
      thinkingLevel: conversations.thinkingLevel,
    });

  if (!row) return json({ error: 'Conversation not found' }, { status: 404 });
  return { ok: true, id: row.id, title: row.title, pinned: row.pinned, thinkingLevel: row.thinkingLevel };
});

async function changeModel(id: string, provider: unknown, modelId: unknown): Promise<Response> {
  if (provider !== 'openrouter' && provider !== 'codex') {
    return json({ error: 'That is not a model this site can run.' }, { status: 400 });
  }
  if (typeof modelId !== 'string' || modelId.length === 0) {
    return json({ error: 'Choose a model.' }, { status: 400 });
  }
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(orchestratorChats)
    .where(eq(orchestratorChats.conversationId, id));
  if (cnt > 0) {
    return json({ error: 'The model is fixed once a thread has its first message. Start a new thread to change it.' }, { status: 409 });
  }
  const priceSnapshot = await snapshotPrice({ provider, modelId });
  const [row] = await db
    .update(conversations)
    .set({ modelProvider: provider, modelId, priceSnapshot, modelPinnedByUser: true })
    .where(eq(conversations.id, id))
    .returning({ id: conversations.id, modelProvider: conversations.modelProvider, modelId: conversations.modelId });
  if (!row) return json({ error: 'Conversation not found' }, { status: 404 });
  return json({ ok: true, ...row });
}

export const DELETE: RequestHandler = withDevice(async ({ params }) => {
  const [row] = await db
    .delete(conversations)
    .where(eq(conversations.id, params.id))
    .returning({ id: conversations.id });
  if (!row) return json({ error: 'Conversation not found' }, { status: 404 });
  return { ok: true, deleted: row.id };
});
