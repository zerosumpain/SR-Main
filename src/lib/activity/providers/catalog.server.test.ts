import { describe, expect, it } from 'vitest';
import { activityProviderStartState } from './catalog.server';

describe('activity provider onboarding readiness', () => {
  it('requires launch, operator credentials and both feature flags', () => {
    expect(
      activityProviderStartState({
        availability: 'planned',
        fabricEnabled: true,
        providerEnabled: true,
        operatorConfigured: true,
      }),
    ).toEqual({ startBlocker: 'not_launched', canStart: false });

    expect(
      activityProviderStartState({
        availability: 'beta',
        fabricEnabled: true,
        providerEnabled: true,
        operatorConfigured: false,
      }),
    ).toEqual({ startBlocker: 'operator_setup_required', canStart: false });

    expect(
      activityProviderStartState({
        availability: 'beta',
        fabricEnabled: true,
        providerEnabled: true,
        operatorConfigured: true,
      }),
    ).toEqual({ startBlocker: null, canStart: true });
  });
});
