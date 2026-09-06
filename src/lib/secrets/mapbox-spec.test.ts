import { describe, it, expect } from 'vitest';
import { CREDENTIAL_REQUEST_SPECS, specByHandle, credentialProviderKeys } from './credential-requests';
import { MAPBOX_API_SECRET_HANDLE } from '$lib/maps/mapbox-api';

const spec = CREDENTIAL_REQUEST_SPECS['mapbox-api'];

describe('mapbox-api credential spec', () => {
  it('is offered as a known provider, so nobody has to hand-build the binding', () => {
    expect(credentialProviderKeys()).toContain('mapbox-api');
    expect(specByHandle('mapbox-api')?.provider).toBe('mapbox-api');
  });

  it('uses the handle the client resolves', () => {
    expect(spec.binding.handle).toBe(MAPBOX_API_SECRET_HANDLE);
    expect(spec.binding.source).toBe('vault');
  });

  it('asks for exactly one thing', () => {
    expect(spec.assemble).toBe('single');
    expect(spec.fields).toHaveLength(1);
    expect(spec.fields[0].type).toBe('password');
    expect(spec.fields[0].required).toBe(true);
  });

  it('sends the token as a query parameter — a bearer binding authenticates nothing', () => {
    // Mapbox reads `?access_token=`. A header or bearer injection here would
    // 401 on every call with a message that says nothing about injection.
    expect(spec.binding.injection).toEqual({ kind: 'query', name: 'access_token' });
  });

  it('is bound to Mapbox only, and only to the four endpoints actually used', () => {
    expect(spec.binding.allowedHosts).toEqual(['api.mapbox.com']);
    expect(spec.binding.allowedPathPrefixes).toEqual([
      '/search/searchbox/v1/',
      '/directions/v5/',
      '/directions-matrix/v1/',
      '/isochrone/v1/',
    ]);
  });

  it('stays read-only — every endpoint used is a GET', () => {
    expect(spec.binding.allowedMethods).toEqual(['GET', 'HEAD']);
    expect(spec.binding.allowedMethods).not.toContain('POST');
  });

  it('tells the owner this is a SECOND token, which is the thing that trips people', () => {
    // The map credential in Admin → Connections is URL-restricted and returns
    // 403 to a server request. Someone pasting it here would get a dead
    // integration and no clue why.
    expect(spec.fields[0].help).toMatch(/NO URL restriction/i);
    expect(spec.fields[0].help).toMatch(/server-side/i);
    expect(spec.helpUrl).toMatch(/mapbox\.com/);
  });

  it('does not quietly widen any other provider', () => {
    expect(CREDENTIAL_REQUEST_SPECS.openrouteservice.binding.allowedHosts).not.toContain('api.mapbox.com');
    expect(CREDENTIAL_REQUEST_SPECS.truelayer.binding.allowedHosts).not.toContain('api.mapbox.com');
  });
});
