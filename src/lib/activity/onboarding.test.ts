import { describe, expect, it } from 'vitest';
import { getActivityOnboardingGuide } from './onboarding';

describe('activity onboarding guides', () => {
  it('never asks a live provider user for their password', () => {
    for (const provider of ['steam', 'apple_music', 'github']) {
      const guide = getActivityOnboardingGuide(provider, 'oauth');
      expect(guide.neverReceives.join(' ')).toMatch(/password/i);
      expect(`${guide.actionDescription} ${guide.prerequisites.join(' ')}`).not.toMatch(
        /enter|paste.*password/i,
      );
    }
  });

  it('routes YouTube Music through a user-selected Takeout ZIP', () => {
    const guide = getActivityOnboardingGuide('youtube_takeout', 'import');
    expect(guide.preparation?.url).toBe('https://takeout.google.com/');
    expect(guide.prerequisites.join(' ')).toMatch(/JSON/i);
    expect(guide.neverReceives.join(' ')).toMatch(/ongoing access/i);
  });

  it('does not claim Apple Podcasts has listener authorization', () => {
    const guide = getActivityOnboardingGuide('apple_podcasts', 'import');
    expect(guide.actionDescription).toMatch(/does not currently provide/i);
    expect(guide.actionDescription).not.toMatch(/OAuth/i);
  });
});
