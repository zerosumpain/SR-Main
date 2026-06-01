import type { PageServerLoad } from './$types';
import os from 'node:os';
import {
  IS_HOMESERV,
  listSessions,
  searchSessions,
  SESSION_SOURCES,
} from '$lib/server/hermes-sessions';

export const load: PageServerLoad = async ({ url }) => {
  const source = url.searchParams.get('source') ?? 'jkai';
  const q = (url.searchParams.get('q') ?? '').trim();
  const base = {
    hostname: os.hostname(),
    sources: SESSION_SOURCES,
    source,
    q,
  };

  // Hermes' state.db lives on homeserv; the VPS deploy can't read it. Render a
  // pointer rather than failing.
  if (!IS_HOMESERV) {
    return { ...base, available: false, sessions: [], hits: [], error: null };
  }

  try {
    if (q) {
      const hits = await searchSessions(q, { source });
      return { ...base, available: true, sessions: [], hits, error: null };
    }
    const sessions = await listSessions({ source });
    return { ...base, available: true, sessions, hits: [], error: null };
  } catch (e) {
    return { ...base, available: true, sessions: [], hits: [], error: (e as Error).message };
  }
};
