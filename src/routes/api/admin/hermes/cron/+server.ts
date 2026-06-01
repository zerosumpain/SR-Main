import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { listCron, runCronOp, type CronOp } from '$lib/server/hermes-cron';

const VALID_OPS = ['create', 'pause', 'resume', 'run', 'remove'];

export const GET: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  return json(await listCron());
};

export const POST: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  const body = (await request.json().catch(() => ({}))) as Partial<CronOp> & { op?: string };
  if (!body?.op || !VALID_OPS.includes(body.op)) throw error(400, 'unknown cron op');
  // runCronOp does the detailed validation (schedule/deliver/id) + returns {ok,error}.
  return json(await runCronOp(body as CronOp));
};
