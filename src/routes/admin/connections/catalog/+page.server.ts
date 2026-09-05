import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { listCatalogProviders } from '$lib/activity/providers/catalog';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import {
  ActivityFlagError,
  setActivityFabricEnabled,
  setActivityProviderEnabled,
} from '$lib/activity/providers/flags.server';
import { activitySecretState } from '$lib/activity/providers/secrets.server';

export const load: PageServerLoad = async () => {
  const [feature, manifests] = await Promise.all([
    getActivityFeatureState(),
    Promise.resolve(listCatalogProviders()),
  ]);
  return {
    ...feature,
    vaultConfigured: /^[0-9a-f]{64}$/i.test(process.env.INTEGRATION_CREDENTIALS_KEY ?? ''),
    credentialState: Object.fromEntries(
      await Promise.all(
        manifests.map(async (manifest) => [
          manifest.id,
          await Promise.all(manifest.requiredSecrets.map(activitySecretState)),
        ]),
      ),
    ),
  };
};

export const actions: Actions = {
  setFabric: async ({ request }) => {
    const data = await request.formData();
    const enabled = data.get('enabled') === 'true';
    await setActivityFabricEnabled(enabled);
    return { ok: true, enabled };
  },
  setProvider: async ({ request }) => {
    const data = await request.formData();
    const providerId = String(data.get('provider') ?? '');
    const enabled = data.get('enabled') === 'true';
    try {
      await setActivityProviderEnabled(providerId, enabled);
    } catch (error) {
      if (error instanceof ActivityFlagError) {
        return fail(error.code === 'provider_not_found' ? 404 : 409, { ok: false, error: error.message });
      }
      throw error;
    }
    return { ok: true, providerId, enabled };
  },
};
