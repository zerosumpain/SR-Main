import { json } from '@sveltejs/kit';
import { getDeployVersion } from '$lib/server/deploy-version';
import type { RequestHandler } from './$types';

/** Public, non-sensitive deployment identity for cache and release diagnosis. */
export const GET: RequestHandler = () =>
  json(getDeployVersion(), {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
    },
  });
