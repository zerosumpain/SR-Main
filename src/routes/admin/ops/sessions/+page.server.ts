import type { PageServerLoad } from './$types';
import os from 'node:os';
import { SESSION_SOURCES } from '$lib/server/hermes-sessions';
import { canManageHermes, rSessions, rStatus } from '$lib/server/hermes-remote';

export const load: PageServerLoad = async ({ url }) => {
  const source = url.searchParams.get('source') ?? 'jkai';
  const q = (url.searchParams.get('q') ?? '').trim();
  const base = { hostname: os.hostname(), sources: SESSION_SOURCES, source, q };

  // Works on both hosts now: direct on homeserv, proxied over Tailscale on the
  // VPS. `available` only goes false when no homeserv route is configured.
  if (!canManageHermes()) {
    return { ...base, available: false, sessions: [], hits: [], storeNewestAt: null, error: null };
  }
  try {
    // Date the list. `listSessions` is `ORDER BY started_at DESC LIMIT n` with
    // no date filter, so a store that stopped receiving anything still renders
    // a perfectly normal newest-first page — it just never moves again. That is
    // the worst of the stale surfaces, because nothing about it looks wrong.
    const [{ sessions, hits }, storeNewestAt] = await Promise.all([
      rSessions(source, q),
      rStatus().then((s) => s.storeNewestAt).catch(() => null),
    ]);
    return { ...base, available: true, sessions, hits, storeNewestAt, error: null };
  } catch (e) {
    return { ...base, available: true, sessions: [], hits: [], storeNewestAt: null, error: (e as Error).message };
  }
};
