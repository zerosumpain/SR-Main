import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { isOwnerEmail } from '$lib/server/access';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { familyId } from '$lib/family/roster.server';
import { samePerson } from '$lib/family/alarm';
import { messageViews, parseBody, REACTIONS } from '$lib/family/messages';
import { recentMessages, sendMessage } from '$lib/family/messages.server';

/**
 * GET /api/native/family/messages — "msg family" in the app's chat: the last
 * 30 days' messages (newest first, at most 50), each with its replies, and
 * the quick-reply emoji. People are ids and names; no email leaves the server.
 *
 * POST — `{ body }`: store it and push it to every OTHER family member's
 * site-paired phone. At most five a minute per sender (429 `retryAfter`).
 * Answers `{ message, pushed, recipients }`.
 *
 * Family only, as /api/native/family/tasks: the owner's phone or a Family
 * Circle / Family Admin member's. Everyone else 403s.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const mine = (email: string) => samePerson(email, caller.email, isOwnerEmail);
  return {
    me: { id: familyId(caller.email) },
    reactions: [...REACTIONS],
    messages: messageViews(await recentMessages(), familyId, mine),
  };
});

export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const input = parseBody(await event.request.json().catch(() => null));
  if ('error' in input) return json({ error: input.error }, { status: 400 });
  const result = await sendMessage(caller.email, caller.parent, input.body);
  if (result.kind === 'limited') {
    return json(
      { error: 'That is a lot of messages at once. Try again in a minute.', retryAfter: result.retryAfterSeconds },
      { status: 429, headers: { 'retry-after': String(result.retryAfterSeconds) } },
    );
  }
  const [message] = messageViews([result.message], familyId, () => true);
  return json({ message, pushed: result.pushed, recipients: result.recipients }, { status: 201 });
});
