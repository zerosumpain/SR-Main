import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { listCatalogProviders } from '$lib/activity/providers/catalog';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import { setSetting } from '$lib/server/models/settings';
import { ACTIVITY_SETTINGS_ENABLED_KEY, activityProviderSettingKey } from '$lib/activity/config';

export const load: PageServerLoad = async () => {
  const [feature, manifests] = await Promise.all([
    getActivityFeatureState(),
    Promise.resolve(listCatalogProviders()),
  ]);
  return {
    ...feature,
    vaultConfigured: /^[0-9a-f]{64}$/i.test(process.env.INTEGRATION_CREDENTIALS_KEY ?? ''),
    credentialState: Object.fromEntries(
      manifests.map((manifest) => [
        manifest.id,
        manifest.requiredSecrets.map((name) => ({ name, configured: Boolean(process.env[name]) })),
      ]),
    ),
  };
};

export const actions: Actions = {
  setFabric: async ({ request }) => {
    const data = await request.formData();
    const enabled = data.get('enabled') === 'true';
    await setSetting(ACTIVITY_SETTINGS_ENABLED_KEY, enabled);
    return { ok: true, enabled };
  },
  setProvider: async ({ request }) => {
    const data = await request.formData();
    const providerId = String(data.get('provider') ?? '');
    const manifest = listCatalogProviders().find((provider) => provider.id === providerId);
    if (!manifest) return fail(404, { ok: false, error: 'Unknown provider' });
    if (manifest.availability !== 'available' && manifest.availability !== 'beta') {
      return fail(409, { ok: false, error: `${manifest.name} has not passed its launch gate` });
    }
    const enabled = data.get('enabled') === 'true';
    await setSetting(activityProviderSettingKey(providerId), enabled);
    return { ok: true, providerId, enabled };
  },
};
