import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_ONBOARDING_OUTCOMES,
  describeStartBlocker,
  getActivityOnboardingGuide,
  isActivityOnboardingOutcomeId,
  readinessRows,
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

describe('readiness rows — the Connect step as a checklist', () => {
  const steam = {
    name: 'Steam',
    availability: 'beta',
    availabilityNote: 'Playtime is a cumulative snapshot.',
    modes: ['openid'],
    enabled: false,
    canStart: false,
    startBlocker: 'operator_setup_required' as const,
    operatorSetup: [{ name: 'STEAM_WEB_API_KEY', configured: false, source: null, vaultManaged: true }],
  };

  it('offers the key form and the switch when a launched provider has neither', () => {
    const rows = readinessRows(steam, false);
    expect(rows.map((row) => [row.id, row.state])).toEqual([
      ['launch', 'done'],
      ['key', 'todo'],
      ['switch', 'todo'],
      ['next', 'blocked'],
    ]);
    expect(rows.find((row) => row.id === 'key')?.secret).toBe('STEAM_WEB_API_KEY');
    expect(rows.find((row) => row.id === 'switch')?.detail).toMatch(/fabric/i);
  });

  it('unlocks sign-in only when everything above is done', () => {
    const rows = readinessRows(
      {
        ...steam,
        enabled: true,
        canStart: true,
        startBlocker: null,
        operatorSetup: [{ name: 'STEAM_WEB_API_KEY', configured: true, source: 'vault', vaultManaged: true }],
      },
      true,
    );
    expect(rows.every((row) => row.id === 'next' || row.state === 'done')).toBe(true);
    expect(rows.at(-1)).toMatchObject({ id: 'next', state: 'todo' });
    expect(rows.find((row) => row.id === 'key')?.detail).toMatch(/vault/i);
  });

  it('blocks everything behind an unpassed launch gate and says why', () => {
    const rows = readinessRows(
      {
        name: 'YouTube Music',
        availability: 'planned',
        availabilityNote: 'Import only.',
        policyGate: 'Enable only after an owner fixture confirms format.',
        modes: ['import'],
        enabled: false,
        canStart: false,
        startBlocker: 'not_launched',
        operatorSetup: [],
      },
      true,
    );
    expect(rows[0]).toMatchObject({ id: 'launch', state: 'blocked', detail: expect.stringMatching(/fixture/) });
    expect(rows.find((row) => row.id === 'switch')?.state).toBe('blocked');
    expect(rows.at(-1)).toMatchObject({ id: 'next', label: 'Archive upload', state: 'blocked' });
  });

  it('never offers the page form for a secret the vault cannot hold', () => {
    const rows = readinessRows(
      {
        ...steam,
        name: 'Apple Music',
        operatorSetup: [{ name: 'APPLE_MUSIC_PRIVATE_KEY', configured: false, source: null, vaultManaged: false }],
      },
      true,
    );
    expect(rows.find((row) => row.id === 'key')).toMatchObject({ state: 'blocked', detail: expect.stringMatching(/environment/) });
  });

  it('adds a blocked vault row and withholds the paste form when the server has no master key', () => {
    const rows = readinessRows(steam, true, false);
    expect(rows.find((row) => row.id === 'vault')).toMatchObject({
      state: 'blocked',
      detail: expect.stringMatching(/INTEGRATION_CREDENTIALS_KEY/),
    });
    expect(rows.find((row) => row.id === 'key')?.state).toBe('blocked');
  });

  it('asks for the key again, with the reason, when a stored row cannot be read here', () => {
    const rows = readinessRows(
      {
        ...steam,
        operatorSetup: [{
          name: 'STEAM_WEB_API_KEY',
          configured: false,
          source: null,
          vaultManaged: true,
          unavailableReason: 'The stored key cannot be read on this host.',
        }],
      },
      true,
    );
    expect(rows.find((row) => row.id === 'key')).toMatchObject({
      state: 'todo',
      detail: expect.stringMatching(/cannot be read on this host/),
    });
  });

  it('describes every blocker in plain words', () => {
    expect(describeStartBlocker(null)).toBe('Ready now');
    expect(describeStartBlocker('operator_setup_required')).toMatch(/key/i);
    expect(describeStartBlocker('fabric_disabled')).toMatch(/off/i);
  });
});
