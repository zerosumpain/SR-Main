// POST /api/projects/local-plan-navigator/ask — the "describe a problem"
// answers for the Local Plan Navigator, a public static bundle at
// /projects/local-plan-navigator.
//
// The page searches its own corpus in the browser and shows the passages it
// found; it sends the question and those passages' ids here, and this route
// streams back a short, cited summary written by the site's model. The
// passage TEXT is read from the server's copy of the corpus, never from the
// request, so a visitor cannot smuggle text into the prompt as "guidance".
//
// Public and anonymous, so three limits: the shared handler's per-IP token
// bucket, a per-day cap on calls for the whole site (the model is the ChatGPT
// subscription — quota, not cash, but finite), and the body caps in
// $lib/projects/local-plan-navigator/ask. CORS is open because the bundle is
// also downloadable and may be served from elsewhere; the endpoint has nothing
// to protect beyond those limits.
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withActivity } from '$lib/context/activity';
import { createProjectChatCore } from '$lib/projects/chat.server';
import { resolveLocalPlanNavigatorModel } from '$lib/server/models/workload-settings';
import { parseAskBody, pickChunks, toChatChunks, SYSTEM_PROMPT } from '$lib/projects/local-plan-navigator/ask';
import { loadNavigatorCorpus } from '$lib/projects/local-plan-navigator/corpus.server';

const DAILY_CAP = Number(process.env.LOCAL_PLAN_NAVIGATOR_DAILY_CAP ?? 400);
let day = '';
let usedToday = 0;

function underDailyCap(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; usedToday = 0; }
  if (usedToday >= DAILY_CAP) return false;
  usedToday++;
  return true;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};

const core = createProjectChatCore({
  slug: 'local-plan-navigator',
  systemPrompt: SYSTEM_PROMPT,
  corpusLabel: 'guidance, regulations and national policy the page found',
  answerScope: 'context passages above',
  scopeLabel: 'local plan-making',
  timeoutMs: 60_000,
  resolveModel: resolveLocalPlanNavigatorModel,
  retrieve: async (_question, _limit, { body }) => {
    const { ids } = parseAskBody(body);
    if (!ids.length) return [];
    const byId = await loadNavigatorCorpus();
    return toChatChunks(pickChunks(ids, byId));
  },
});

export const POST: RequestHandler = (event) =>
  withActivity('local-plan-navigator', async () => {
    if (!underDailyCap()) {
      throw error(503, "The site's model has answered its daily allowance of questions. Run a model on your own device instead, or try tomorrow.");
    }
    const response = await core(event);
    for (const [k, v] of Object.entries(CORS)) response.headers.set(k, v);
    return response;
  });

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
