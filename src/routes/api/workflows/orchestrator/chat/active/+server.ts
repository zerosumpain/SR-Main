import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getRunningJobIdForConversation, listRunningJobsByConversation } from '$lib/workflows/chat/job-store';
import { chatAccess } from '$lib/jkai/chat-access.server';

// GET /api/workflows/orchestrator/chat/active?conversationId=<id>
//   → { jobId: string | null }
// GET /api/workflows/orchestrator/chat/active
//   → { jobs: Array<{ conversationId: string; jobId: string }> }
//
// The owner sees every running turn. A member sees only their own: a member
// posts only in their own thread, so "their jobs" and "the running turn in a
// thread of theirs" are the same set, and any other thread answers null.
export const GET: RequestHandler = async (event) => {
  const { url } = event;
  const access = await chatAccess(event);
  const isOwner = access.level === 'owner';
  const conversationId = url.searchParams.get('conversationId');
  if (conversationId) {
    if (isOwner) return json({ jobId: getRunningJobIdForConversation(conversationId) });
    return json({ jobId: listRunningJobsByConversation({ principalId: access.own }).get(conversationId) ?? null });
  }

  const map = isOwner ? listRunningJobsByConversation() : listRunningJobsByConversation({ principalId: access.own });
  const jobs = Array.from(map.entries()).map(([conversationId, jobId]) => ({ conversationId, jobId }));
  return json({ jobs });
};
