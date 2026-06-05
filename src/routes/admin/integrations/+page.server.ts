import type { PageServerLoad } from './$types';
import { listCredentials } from '$lib/integrations/credentials';
import { listIntegrationAdapters } from '$lib/integrations/registry';
import { getManualCredentialSpec } from '$lib/integrations/manual-credentials';

export const load: PageServerLoad = async () => {
  const credentials = await listCredentials();
  const adapters = listIntegrationAdapters().map((a) => ({
    integrationType: a.integrationType,
    hasOauth: !!a.oauthSpec,
    hasOptions: !!a.resolveOptions,
    hasTest: !!a.testCredential,
    manualCredential: getManualCredentialSpec(a.integrationType) ?? null,
  }));
  // Group credentials by integrationType for display.
  const grouped: Record<string, typeof credentials> = {};
  for (const c of credentials) {
    (grouped[c.integrationType] ??= []).push(c);
  }
  return { grouped, adapters };
};
