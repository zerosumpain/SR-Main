import type { PageServerLoad } from './$types';
import os from 'node:os';
import { SESSION_SOURCES } from '$lib/server/hermes-sessions';
import { canManageHermes, rSessions } from '$lib/server/hermes-remote';

export const load: PageServerLoad = async ({ url }) => {
  const source = url.searchParams.get('source') ?? 'jkai';
  const q = (url.searchParams.get('q') ?? '').trim();
  const base = { hostname: os.hostname(), sources: SESSION_SOURCES, source, q };

  // Works on both hosts now: direct on homeserv, proxied over Tailscale on the
  // VPS. `available` only goes false when no homeserv route is configured.
  if (!canManageHermes()) {
    return { ...base, available: false, sessions: [], hits: [], error: null };
  }
  try {
    const { sessions, hits } = await rSessions(source, q);
    return { ...base, available: true, sessions, hits, error: null };
  } catch (e) {
    return { ...base, available: true, sessions: [], hits: [], error: (e as Error).message };
  }
};
