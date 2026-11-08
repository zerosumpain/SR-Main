import { describe, expect, it } from 'vitest';
import { checkManualPayload, getManualCredentialSpec } from '$lib/integrations/manual-credentials';
import { getIntegrationAdapter } from '$lib/integrations/registry';
import '$lib/integrations/adapters';

// 2026-10-31: with no adapter, the Mapbox token sat under "Orphaned
// credentials" with only a Delete button, was deleted, and every /health map
// went blank. These pin the pieces that give it a proper, replaceable section.
describe('Mapbox credential', () => {
  it('has a registered adapter, so it is not listed as orphaned', () => {
    expect(getIntegrationAdapter('mapbox')).toBeDefined();
  });

  it('has no server-side test — a URL-restricted token 403s without a browser Referer', () => {
    expect(getIntegrationAdapter('mapbox')?.testCredential).toBeUndefined();
  });

  it('is a single-key form, so Replace key works on the same row', () => {
    const spec = getManualCredentialSpec('mapbox');
    expect(spec?.kind).toBe('apikey');
    expect(spec?.fields.map((f) => f.key)).toEqual(['key']);
  });

  it('accepts a public token', () => {
    expect(checkManualPayload('mapbox', { key: 'pk.eyJ1IjoieCJ9.aaaaaaaa' })).toBeNull();
  });

  it('refuses a secret token, which would be sent to every browser', () => {
    expect(checkManualPayload('mapbox', { key: 'sk.eyJ1IjoieCJ9.aaaaaaaa' })).toMatch(/pk\./);
    expect(checkManualPayload('mapbox', { key: 'not-a-token' })).toMatch(/pk\./);
  });

  it('does not apply the Mapbox rule to other integrations', () => {
    expect(checkManualPayload('apple-calendar', { username: 'a', password: 'b' })).toBeNull();
  });
});
