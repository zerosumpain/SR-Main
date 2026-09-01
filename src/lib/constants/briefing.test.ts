import { describe, expect, it } from 'vitest';
import { DEFAULT_BRIEFING_PROFILE, normaliseBriefingProfile } from './briefing';

describe('normaliseBriefingProfile', () => {
  it('starts with every supported source enabled', () => {
    const profile = normaliseBriefingProfile(null);
    expect(profile.sources.memories.enabled).toBe(true);
    expect(profile.sources.location.enabled).toBe(true);
    expect(profile.memoryLimit).toBe(DEFAULT_BRIEFING_PROFILE.memoryLimit);
  });

  it('preserves known preferences, ignores unknown sources and bounds memory controls', () => {
    const profile = normaliseBriefingProfile({
      sources: {
        email: { enabled: false, required: true },
        madeUp: { enabled: false },
      },
      memoryLookbackHours: 999,
      memoryLimit: 0,
    });
    expect(profile.sources.email).toEqual({ enabled: false, required: true });
    expect('madeUp' in profile.sources).toBe(false);
    expect(profile.memoryLookbackHours).toBe(168);
    expect(profile.memoryLimit).toBe(1);
  });
});
