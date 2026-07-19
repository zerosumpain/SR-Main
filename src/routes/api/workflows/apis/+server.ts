import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listCatalogApis } from '$lib/workflows/site-tools/tools/apis';

/**
 * List the registered APIs in the permanent `api_catalog`, for the ApiCallPanel's
 * picker (name, baseUrl, capabilities, auth kind, status, example requests). The
 * catalogue is the same one the self-improvement engine grows and the `api_call`
 * site tool uses. Returns an empty list if the catalogue is not seeded yet. Auth
 * is enforced by hooks (owner-gated authed area), like the sibling workflow routes.
 */
export const GET: RequestHandler = async () => {
  const apis = await listCatalogApis();
  return json({ apis });
};
