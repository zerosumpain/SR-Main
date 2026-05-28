import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getRunningJobIdForConversation, listRunningJobsByConversation } from '$lib/workflows/chat/job-store';

// GET /api/workflows/orchestrator/chat/active?conversationId=<id>
//   → { jobId: string | null }
// GET /api/workflows/orchestrator/chat/active
//   → { jobs: Array<{ conversationId: string; jobId: string }> }
export const GET: RequestHandler = async ({ url }) => {
  const conversationId = url.searchParams.get('conversationId');
  if (conversationId) {
    return json({ jobId: getRunningJobIdForConversation(conversationId) });
  }

  const map = listRunningJobsByConversation();
  const jobs = Array.from(map.entries()).map(([conversationId, jobId]) => ({ conversationId, jobId }));
  return json({ jobs });
};
