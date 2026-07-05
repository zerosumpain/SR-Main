import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { probeArchitecture } from '$lib/architecture/health';

// Owner-gated by hooks (/api/admin/*). Polled by the architecture map for live status.
export const GET: RequestHandler = async () => {
  return json({ health: await probeArchitecture(), at: Date.now() });
};
