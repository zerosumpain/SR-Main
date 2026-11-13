import { describe, it, expect } from 'vitest';
import { authEnvHostPins, authEnvRefusal } from './api-auth-env';

const CH = 'api.company-information.service.gov.uk';

describe('env-var API auth is pinned to hosts', () => {
  it('lets the seeded key go to its own host', () => {
    expect(authEnvRefusal('COMPANIES_HOUSE_API_KEY', CH, {})).toBeNull();
  });

  // The attack this closes: an allowed key paired with somebody else's host.
  it.each(['attacker.example', `evil.${CH}`, 'company-information.service.gov.uk'])(
    'refuses the seeded key for %s',
    (host) => {
      expect(authEnvRefusal('COMPANIES_HOUSE_API_KEY', host, {})).toMatch(/pinned to/);
    },
  );

  it('refuses names that are not allow-listed at all', () => {
    expect(authEnvRefusal('AUTH_SECRET', CH, {})).toMatch(/not on the API-auth allowlist/);
  });

  it('reads owner pins as NAME@host|host', () => {
    const env = { API_CATALOG_ALLOWED_ENV: 'FOO_KEY@api.foo.test|Data.Foo.Test., BAR_KEY@bar.test' };
    expect(authEnvHostPins(env).get('FOO_KEY')).toEqual(['api.foo.test', 'data.foo.test']);
    expect(authEnvRefusal('FOO_KEY', 'data.foo.test', env)).toBeNull();
    expect(authEnvRefusal('BAR_KEY', 'api.foo.test', env)).toMatch(/pinned to bar\.test/);
  });

  it('treats a bare name (the old format) as authorising no host', () => {
    const env = { API_CATALOG_ALLOWED_ENV: 'LEGACY_KEY' };
    expect(authEnvRefusal('LEGACY_KEY', 'anything.test', env)).toMatch(/allowed without a host/);
  });
});
