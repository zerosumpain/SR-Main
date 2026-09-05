/**
 * The two switches every activity job checks: the fabric as a whole, and one
 * per provider. Both are `app_settings` rows so they can move without a
 * deploy.
 *
 * One implementation, two callers: the operator catalogue at
 * `/admin/connections/catalog` and the guided setup's "Turn on" button. The
 * launch gate is enforced here so neither surface can enable a provider that
 * has not passed it.
 */
import { setSetting } from '$lib/server/models/settings';
import { ACTIVITY_SETTINGS_ENABLED_KEY, activityProviderSettingKey } from '../config';
import { listCatalogProviders } from './catalog';

export class ActivityFlagError extends Error {
  constructor(
    readonly code: 'provider_not_found' | 'launch_gate',
    message: string,
  ) {
    super(message);
    this.name = 'ActivityFlagError';
  }
}

export async function setActivityFabricEnabled(enabled: boolean): Promise<void> {
  await setSetting(ACTIVITY_SETTINGS_ENABLED_KEY, enabled);
}

export async function setActivityProviderEnabled(providerId: string, enabled: boolean): Promise<void> {
  const manifest = listCatalogProviders().find((provider) => provider.id === providerId);
  if (!manifest) throw new ActivityFlagError('provider_not_found', 'Unknown activity provider');
  if (enabled && manifest.availability !== 'available' && manifest.availability !== 'beta') {
    throw new ActivityFlagError('launch_gate', `${manifest.name} has not passed its launch gate`);
  }
  await setSetting(activityProviderSettingKey(providerId), enabled);
}

/** Turn on everything a provider needs to start: the fabric and its own flag. */
export async function enableActivityProvider(providerId: string): Promise<void> {
  await setActivityProviderEnabled(providerId, true);
  await setActivityFabricEnabled(true);
}
