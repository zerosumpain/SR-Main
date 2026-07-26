import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listIntegrationsForPicker } from '$lib/apis/integrations';

/**
 * List the recorded API integrations for the ApiIntegrationPanel's picker —
 * name, host, method/path, params, named outputs, test evidence. Sibling of
 * /api/workflows/apis (which lists the API catalogue). Auth is enforced by hooks
 * (owner-gated authed area), like the other workflow routes.
 *
 * NB the path is `api-integrations`, not `integrations`: /api/workflows/integrations
 * already serves the unrelated OAuth `integrations` table.
 *
 * Returns metadata only — `secretHandle` is a credential NAME. There is no code
 * path from this route to a secret's value.
 */
export const GET: RequestHandler = async () => {
  const integrations = await listIntegrationsForPicker();
  return json({ integrations });
};
