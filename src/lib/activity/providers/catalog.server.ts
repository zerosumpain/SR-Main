import { getSetting } from '$lib/server/models/settings';
import { ACTIVITY_SETTINGS_ENABLED_KEY, activityProviderSettingKey } from '../config';
import type { ProviderManifest } from '../contracts';
import { listCatalogProviders } from './catalog';
import { activitySecretState, vaultKeyConfigured, type ActivitySecretState } from './secrets.server';

export interface PublicActivityProvider extends Omit<ProviderManifest, 'requiredSecrets'> {
  enabled: boolean;
  operatorConfigured: boolean;
  /**
   * One row per application secret the provider needs: the env name (not
   * secret), whether it is set, where it came from, and whether the guided
   * setup can collect it into the vault. Never a value.
   */
  operatorSetup: ActivitySecretState[];
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
  /** Whether this host can hold account tokens and vault keys at all. */
  vaultConfigured: boolean;
  providers: PublicActivityProvider[];
}> {
  const manifests = listCatalogProviders();
  const [fabric, providerFlags, secretStates] = await Promise.all([
    getSetting<boolean>(ACTIVITY_SETTINGS_ENABLED_KEY),
    Promise.all(manifests.map((manifest) => getSetting<boolean>(activityProviderSettingKey(manifest.id)))),
    // A secret counts as configured from EITHER `.env` or the vault — see
    // `secrets.server.ts` for why the env-only check left every card dead.
    Promise.all(
      manifests.map((manifest) => Promise.all(manifest.requiredSecrets.map(activitySecretState))),
    ),
  ]);
  const enabled = fabric === true;
  const vaultConfigured = vaultKeyConfigured();
  return {
    enabled,
    vaultConfigured,
    providers: manifests.map(({ requiredSecrets: _requiredSecrets, ...manifest }, index) => {
      const providerEnabled = providerFlags[index] === true;
      const operatorSetup = secretStates[index];
      const operatorConfigured = vaultConfigured && operatorSetup.every((secret) => secret.configured);
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
        operatorSetup,
        ...startState,
      };
    }),
  };
}
