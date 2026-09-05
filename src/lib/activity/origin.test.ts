import { describe, expect, it } from 'vitest';
import { activityPublicOrigin } from './origin';

const request = new URL('https://strangeramblings.com/api/activity/v1/connections/x/authorize');

describe('activityPublicOrigin', () => {
  it('never falls back to localhost — the request origin is the floor', () => {
    expect(activityPublicOrigin(request, {})).toBe('https://strangeramblings.com');
  });

  it('prefers PUBLIC_BASE_URL, then PUBLIC_SITE_URL, and strips a trailing slash', () => {
    expect(activityPublicOrigin(request, { PUBLIC_SITE_URL: 'https://homeserv.tail668b8c.ts.net/' })).toBe(
      'https://homeserv.tail668b8c.ts.net',
    );
    expect(
      activityPublicOrigin(request, { PUBLIC_BASE_URL: 'https://example.test', PUBLIC_SITE_URL: 'https://other.test' }),
    ).toBe('https://example.test');
  });

  it('ignores blank values', () => {
    expect(activityPublicOrigin(request, { PUBLIC_BASE_URL: '  ', PUBLIC_SITE_URL: '' })).toBe(
      'https://strangeramblings.com',
    );
  });
});
