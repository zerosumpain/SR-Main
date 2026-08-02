import type { PageServerLoad } from './$types';
import { listIntegrationsForPicker } from '$lib/apis/integrations';
import { listCatalogApis } from '$lib/workflows/site-tools/tools/apis';
import { listRefSources, listSecrets } from '$lib/secrets/registry';
import { CREDENTIAL_REQUEST_SPECS } from '$lib/secrets/credential-requests';

// The API register. Owner-gated in hooks.server.ts; reads run server-side and
// mutations go through /api/admin/apis/* with ?token= (datastore/blog precedent).
//
// `listSecrets()` returns SecretMeta — handles, bound hosts, availability — and
// by construction no value, so nothing secret crosses to the browser.

// The same catalogue `request_credential` uses, flattened for the quick-add
// form. Only labels and binding facts cross to the browser — a spec has never
// held a value. This is what makes a multi-row credential (an OAuth provider's
// vault row PLUS the ref row that mints from it) a single correct action rather
// than two hand-assembled saves that can be done in the wrong order.
const credentialSpecs = Object.values(CREDENTIAL_REQUEST_SPECS).map((spec) => ({
  provider: spec.provider,
  title: spec.title,
  helpUrl: spec.helpUrl,
  assemble: spec.assemble,
  fields: spec.fields,
  handle: spec.binding.handle,
  hosts: spec.binding.allowedHosts,
  companions: (spec.companions ?? []).map((c) => ({ handle: c.handle, hosts: c.allowedHosts })),
}));

export const load: PageServerLoad = async () => {
  const [integrations, apis, secrets, refSources] = await Promise.all([
    listIntegrationsForPicker().catch(() => []),
    listCatalogApis().catch(() => []),
    listSecrets().catch(() => []),
    Promise.resolve(listRefSources()),
  ]);

  return { integrations, apis, secrets, refSources, credentialSpecs };
};
