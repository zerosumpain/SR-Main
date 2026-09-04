import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_ONBOARDING_OUTCOMES,
  getActivityOnboardingGuide,
  isActivityOnboardingOutcomeId,
  recommendActivityProviders,
} from './onboarding';

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

  it('turns user outcomes into ranked, deduplicated source recommendations', () => {
    const recommendations = recommendActivityProviders(
      ['listen', 'interests'],
      [
        { id: 'steam', category: 'games', canStart: true },
        { id: 'apple_music', category: 'music_podcasts', canStart: false },
        { id: 'youtube_takeout', category: 'music_podcasts', canStart: false },
        { id: 'reddit_archive', category: 'social', canStart: false },
      ],
    );
    expect(recommendations.map((item) => item.provider.id)).toEqual([
      'youtube_takeout',
      'apple_music',
      'reddit_archive',
    ]);
    expect(recommendations[0].reasons).toEqual([
      'Understand my listening',
      'Follow my interests',
    ]);
  });

  it('keeps the outcome vocabulary closed and gives every outcome a payoff', () => {
    expect(isActivityOnboardingOutcomeId('listen')).toBe(true);
    expect(isActivityOnboardingOutcomeId('surveillance')).toBe(false);
    expect(ACTIVITY_ONBOARDING_OUTCOMES.every((outcome) => outcome.daydreamPrompt.length > 20)).toBe(true);
  });
});
