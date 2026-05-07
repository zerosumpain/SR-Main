import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getIntegrationAdapter } from '$lib/integrations';

export const GET: RequestHandler = async ({ params, url }) => {
  const integrationType = params.integrationType;
  const fieldName = params.fieldName;
  const credentialId = url.searchParams.get('credentialId');
  if (!credentialId) throw error(400, 'Missing credentialId');

  const adapter = getIntegrationAdapter(integrationType);
  if (!adapter) throw error(404, `Unknown integrationType: ${integrationType}`);
  if (!adapter.resolveOptions) {
    throw error(400, `${integrationType} does not provide options`);
  }

  try {
    const options = await adapter.resolveOptions(fieldName, credentialId);
    return json({ options });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw error(502, `resolveOptions failed: ${msg}`);
  }
};
