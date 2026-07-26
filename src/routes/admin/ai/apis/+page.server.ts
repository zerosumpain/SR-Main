import type { PageServerLoad } from './$types';
import { listIntegrationsForPicker } from '$lib/apis/integrations';
import { listCatalogApis } from '$lib/workflows/site-tools/tools/apis';
import { listRefSources, listSecrets } from '$lib/secrets/registry';

// The API register. Owner-gated in hooks.server.ts; reads run server-side and
// mutations go through /api/admin/apis/* with ?token= (datastore/blog precedent).
//
// `listSecrets()` returns SecretMeta — handles, bound hosts, availability — and
// by construction no value, so nothing secret crosses to the browser.

export const load: PageServerLoad = async () => {
  const [integrations, apis, secrets, refSources] = await Promise.all([
    listIntegrationsForPicker().catch(() => []),
    listCatalogApis().catch(() => []),
    listSecrets().catch(() => []),
    Promise.resolve(listRefSources()),
  ]);

  return { integrations, apis, secrets, refSources };
};
