import { describe, expect, it } from 'vitest';
import { activityProviderSettingKey } from '../config';

describe('activity provider settings', () => {
  it('uses a separate explicit kill switch per provider', () => {
    expect(activityProviderSettingKey('apple_music')).toBe('activity.provider.apple_music.enabled');
    expect(activityProviderSettingKey('steam')).not.toBe(activityProviderSettingKey('apple_music'));
  });
});
