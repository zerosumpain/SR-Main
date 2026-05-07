import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getIntegrationAdapter } from '$lib/integrations';
import { updateCredential } from '$lib/integrations/credentials';

export const POST: RequestHandler = async ({ params, request }) => {
  const integrationType = params.integrationType;
  const body = (await request.json().catch(() => ({}))) as { credentialId?: string };
  if (!body.credentialId) throw error(400, 'Missing credentialId');

  const adapter = getIntegrationAdapter(integrationType);
  if (!adapter) throw error(404, `Unknown integrationType: ${integrationType}`);
  if (!adapter.testCredential) {
    throw error(400, `${integrationType} does not provide a test handler`);
  }

  try {
    await adapter.testCredential(body.credentialId);
    await updateCredential(body.credentialId, {
      lastTestedAt: new Date(),
      lastTestStatus: 'ok',
      lastTestError: null,
    });
    return json({ status: 'ok' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateCredential(body.credentialId, {
      lastTestedAt: new Date(),
      lastTestStatus: 'failed',
      lastTestError: msg,
    });
    return json({ status: 'failed', error: msg }, { status: 200 });
  }
};
