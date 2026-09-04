export const ACTIVITY_SETTINGS_ENABLED_KEY = 'activity.enabled';

export const ACTIVITY_PROVIDER_SETTING_PREFIX = 'activity.provider.';

export function activityProviderSettingKey(providerId: string): string {
  return `${ACTIVITY_PROVIDER_SETTING_PREFIX}${providerId}.enabled`;
}
