import type { PageServerLoad } from './$types';
import os from 'node:os';
import { error } from '@sveltejs/kit';
import { isValidSessionId, type SessionDetail } from '$lib/server/hermes-sessions';
import { canManageHermes, rSession } from '$lib/server/hermes-remote';

export const load: PageServerLoad = async ({ params }) => {
  if (!canManageHermes()) {
    return { available: false, hostname: os.hostname(), session: null, messages: [], error: null };
  }
  if (!isValidSessionId(params.id)) throw error(400, 'Invalid session id');

  let detail: SessionDetail = { session: null, messages: [] };
  let errMsg: string | null = null;
  try {
    detail = await rSession(params.id);
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
