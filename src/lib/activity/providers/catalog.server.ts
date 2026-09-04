import { getSetting } from '$lib/server/models/settings';
import { ACTIVITY_SETTINGS_ENABLED_KEY, activityProviderSettingKey } from '../config';
import type { ProviderManifest } from '../contracts';
import { listCatalogProviders } from './catalog';

export interface PublicActivityProvider extends Omit<ProviderManifest, 'requiredSecrets'> {
  enabled: boolean;
  operatorConfigured: boolean;
  startBlocker:
    | 'not_launched'
    | 'operator_setup_required'
    | 'fabric_disabled'
    | 'provider_disabled'
    | null;
  canStart: boolean;
}

export function activityProviderStartState(input: {
  availability: ProviderManifest['availability'];
  fabricEnabled: boolean;
  providerEnabled: boolean;
  operatorConfigured: boolean;
}): Pick<PublicActivityProvider, 'startBlocker' | 'canStart'> {
  if (input.availability !== 'available' && input.availability !== 'beta') {
    return { startBlocker: 'not_launched', canStart: false };
  }
  if (!input.operatorConfigured) {
    return { startBlocker: 'operator_setup_required', canStart: false };
  }
  if (!input.fabricEnabled) return { startBlocker: 'fabric_disabled', canStart: false };
  if (!input.providerEnabled) return { startBlocker: 'provider_disabled', canStart: false };
  return { startBlocker: null, canStart: true };
}

export async function getActivityFeatureState(): Promise<{
  enabled: boolean;
  providers: PublicActivityProvider[];
}> {
  const manifests = listCatalogProviders();
  const [fabric, providerFlags] = await Promise.all([
    getSetting<boolean>(ACTIVITY_SETTINGS_ENABLED_KEY),
    Promise.all(manifests.map((manifest) => getSetting<boolean>(activityProviderSettingKey(manifest.id)))),
  ]);
  const enabled = fabric === true;
  const vaultConfigured = /^[0-9a-f]{64}$/i.test(process.env.INTEGRATION_CREDENTIALS_KEY ?? '');
  return {
    enabled,
    providers: manifests.map(({ requiredSecrets: _requiredSecrets, ...manifest }, index) => {
      const providerEnabled = providerFlags[index] === true;
      const operatorConfigured =
        vaultConfigured && _requiredSecrets.every((name) => Boolean(process.env[name]));
      const startState = activityProviderStartState({
        availability: manifest.availability,
        fabricEnabled: enabled,
        providerEnabled,
        operatorConfigured,
      });
      return {
        ...manifest,
        enabled: providerEnabled,
        operatorConfigured,
        ...startState,
      };
    }),
  };
}
