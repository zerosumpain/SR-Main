import { describe, it, expect } from 'vitest';
import { normalizeProfileName, profilePathInSandbox } from '$lib/workflows/scraper/profiles';

describe('profiles', () => {
  it('normalizes profile names to safe filesystem names', () => {
    expect(normalizeProfileName('Civil Service Jobs')).toBe('civil-service-jobs');
    expect(normalizeProfileName('foo.bar/baz')).toBe('foo-bar-baz');
    expect(normalizeProfileName('')).toBe('default');
    expect(normalizeProfileName('___')).toBe('default');
  });

  it('returns the sandbox path for a profile', () => {
    expect(profilePathInSandbox('civilservicejobs-gov-uk')).toBe('/home/jkai/scraper-profiles/civilservicejobs-gov-uk');
  });
});
