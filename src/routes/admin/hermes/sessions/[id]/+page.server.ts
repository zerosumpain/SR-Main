import type { PageServerLoad } from './$types';
import os from 'node:os';
import { error } from '@sveltejs/kit';
import { IS_HOMESERV, getSession, isValidSessionId } from '$lib/server/hermes-sessions';

export const load: PageServerLoad = async ({ params }) => {
  if (!IS_HOMESERV) {
    return { available: false, hostname: os.hostname(), session: null, messages: [], error: null };
  }
  if (!isValidSessionId(params.id)) throw error(400, 'Invalid session id');

  let detail: Awaited<ReturnType<typeof getSession>> = { session: null, messages: [] };
  let errMsg: string | null = null;
  try {
    detail = await getSession(params.id);
  } catch (e) {
    errMsg = (e as Error).message;
  }
  if (!errMsg && !detail.session) throw error(404, 'Session not found');

  return {
    available: true,
    hostname: os.hostname(),
    session: detail.session,
    messages: detail.messages,
    error: errMsg,
  };
};
