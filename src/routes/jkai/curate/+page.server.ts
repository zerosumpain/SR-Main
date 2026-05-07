import os from 'node:os';
import { listActiveSessions } from '$lib/curate/session-store';
import type { PageServerLoad } from './$types';

const HOMESERV_HOSTNAMES = ['homeserv'];

export const load: PageServerLoad = async () => {
  const sessions = await listActiveSessions();
  const isHomeserv = HOMESERV_HOSTNAMES.includes(os.hostname());
  return { sessions, isHomeserv };
};
