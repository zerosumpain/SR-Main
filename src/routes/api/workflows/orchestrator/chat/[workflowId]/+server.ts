import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChatHistory } from '$lib/workflows/orchestrator';

export const GET: RequestHandler = async ({ params }) => {
  const history = await getChatHistory(params.workflowId);
  return json(history);
};
