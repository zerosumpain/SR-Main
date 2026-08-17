import { describe, it, expect } from 'vitest';
import { CREDENTIAL_REQUEST_SPECS, specByHandle, credentialProviderKeys } from './credential-requests';

const spec = CREDENTIAL_REQUEST_SPECS.openrouteservice;

describe('openrouteservice credential spec', () => {
  it('is offered as a known provider, so nobody has to hand-build the binding', () => {
    expect(credentialProviderKeys()).toContain('openrouteservice');
    expect(specByHandle('openrouteservice')?.provider).toBe('openrouteservice');
  });

  it('asks for exactly one thing', () => {
    expect(spec.assemble).toBe('single');
    expect(spec.fields).toHaveLength(1);
    expect(spec.fields[0].type).toBe('password');
    expect(spec.fields[0].required).toBe(true);
  });

  it('points at where the key comes from', () => {
    expect(spec.helpUrl).toMatch(/openrouteservice\.org/);
    expect(spec.fields[0].help).toMatch(/2,500/);
  });

  it('allows POST — the whole reason a hand-made binding fails', () => {
    // Directions is a POST. An empty or GET-only method list rejects every
    // route request with an error that reads nothing like "wrong method".
    expect(spec.binding.allowedMethods).toContain('POST');
  });

  it('sends the raw key in Authorization, not as a bearer token', () => {
    expect(spec.binding.injection).toEqual({ kind: 'header', name: 'Authorization' });
  });

  it('is bound to the ORS host and API prefix only', () => {
    expect(spec.binding.allowedHosts).toEqual(['api.openrouteservice.org']);
    expect(spec.binding.allowedPathPrefixes).toEqual(['/v2/']);
  });

  it('uses the handle the planner resolves', () => {
    expect(spec.binding.handle).toBe('openrouteservice');
    expect(spec.binding.source).toBe('vault');
  });

  it('does not quietly widen any other provider', () => {
    expect(CREDENTIAL_REQUEST_SPECS.truelayer.binding.allowedHosts).not.toContain(
      'api.openrouteservice.org',
    );
  });
});
