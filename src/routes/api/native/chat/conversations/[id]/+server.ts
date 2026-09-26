import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { withNativeAccess } from '$lib/server/native-handler';
import { MEMBER_PATCHABLE, requireConversation } from '$lib/jkai/chat-access.server';
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
 *
 * A MEMBER gets the web's member rule and nothing wider: a thread they may
 * write (404 for one they cannot see, 403 for one they can only read), and only
 * `MEMBER_PATCHABLE` — the name and the pin. The model and the thinking level
 * are refused outright rather than ignored: the model is the owner's spend,
 * and a thinking level here also writes the GLOBAL default for the owner's
 * next thread.
 */
export const PATCH: RequestHandler = withNativeAccess('jkai.chat', async (event, _identity, role) => {
  const { params, request } = event;
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

  if (role === 'member') {
    const { conversation, access } = await requireConversation(event, params.id, 'write');
    const keys = Object.keys(payload);
    const refused = keys.filter((k) => !MEMBER_PATCHABLE.has(k));
    if (refused.length > 0 || keys.length === 0) {
      throw error(403, `Only the title and pin can be changed (refused: ${refused.join(', ') || 'nothing to change'})`);
    }
    // As on the web: the pin orders its OWNER's list, so an admin may rename
    // someone else's thread but not rearrange their list.
    if ('pinned' in payload && conversation.principalId !== access.own) {
      throw error(403, "Only the thread's own member can pin it");
    }
  }

  if ('modelProvider' in payload || 'modelId' in payload) {
    return changeModel(params.id, payload.modelProvider, payload.modelId);
  }

  const set: { title?: string | null; pinned?: boolean; thinkingLevel?: string | null } = {};
  // Unreachable for a member (refused above); kept owner-only by that, not by
  // this branch.
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

// A member deletes a thread they may WRITE — their own, or any member's at
// `admin` — exactly as the web DELETE decides it.
export const DELETE: RequestHandler = withNativeAccess('jkai.chat', async (event, _identity, role) => {
  const { params } = event;
  if (role === 'member') await requireConversation(event, params.id, 'write');
  const [row] = await db
    .delete(conversations)
    .where(eq(conversations.id, params.id))
    .returning({ id: conversations.id });
  if (!row) return json({ error: 'Conversation not found' }, { status: 404 });
  return { ok: true, deleted: row.id };
});
