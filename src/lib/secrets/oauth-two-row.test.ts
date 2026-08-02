// The two rows an OAuth provider needs must stay in agreement.
//
// An OAuth provider is one credential split across two `api_secrets` rows: a
// `<provider>-oauth` vault row holding the client_id/client_secret/refresh_token,
// and a `<provider>` ref row that mints a short-lived access token from it on
// every request. Three files have to describe that identically —
// `oauth-refresh.ts` (which reads it), `credential-requests.ts` (which writes
// it), and the REF_SOURCES table (which resolves it).
//
// When they drift you do not get a type error, you get a handle that looks
// registered and fails at run time. That is exactly what happened on
// 2026-08-02: the ref rows existed, the vault rows did not, nothing checked,
// and the daily-spend-summary canvas failed on a cron for a day. These are
// cheap, pure, and run in the gate — unlike the DB round-trip, which lives in
// tests/lib/secrets/half-registration.integration.test.ts.

import { describe, it, expect, vi } from 'vitest';

// registry.ts imports $lib/db (postgres) at module load — stub it so the pure
// tables can be imported without a database.
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/integrations/crypto', () => ({
  encryptPayload: (s: string) => `enc:${s}`,
  decryptPayload: (s: string) => s.replace(/^enc:/, ''),
}));

import { OAUTH_PROVIDERS, type OAuthProvider } from './oauth-refresh';
import { CREDENTIAL_REQUEST_SPECS } from './credential-requests';
import { listRefSources } from './registry';

const providers = Object.keys(OAUTH_PROVIDERS) as OAuthProvider[];

describe('every OAuth provider is reachable through the credential catalogue', () => {
  it.each(providers)('%s has a catalogue spec', (key) => {
    // Without this the provider can only be entered through the generic admin
    // form, one row at a time — the path that produced the half-registration.
    expect(CREDENTIAL_REQUEST_SPECS[key]).toBeDefined();
  });

  it.each(providers)('%s stores its credential set in the vault row, store-only', (key) => {
    const { binding } = CREDENTIAL_REQUEST_SPECS[key];
    expect(binding.handle).toBe(OAUTH_PROVIDERS[key].vaultHandle);
    expect(binding.source).toBe('vault');
    // `injection: none` is what makes `resolveSecretForUrl` refuse to attach the
    // client_secret to any outbound request. Anything else leaks it.
    expect(binding.injection.kind).toBe('none');
    // Bound to the TOKEN host: `readCredential` re-checks this before sending
    // the secret, so a spec bound elsewhere fails closed at run time.
    expect(binding.allowedHosts).toEqual([OAUTH_PROVIDERS[key].tokenHost]);
  });

  it.each(providers)('%s ships the ref companion that nodes actually reference', (key) => {
    const spec = CREDENTIAL_REQUEST_SPECS[key];
    const companion = (spec.companions ?? []).find((c) => c.handle === key);
    // A spec that writes only the vault row recreates the inverse of the
    // 2026-08-02 outage: a stored credential nothing can reference.
    expect(companion).toBeDefined();
    expect(companion!.source).toBe('ref');
    expect(companion!.refKey).toBe(key);
    expect(companion!.injection.kind).toBe('bearer');
    // The DATA host only. The token endpoint is called directly by
    // oauth-refresh, so where it is a SEPARATE host (TrueLayer: auth. vs api.)
    // it must not be reachable through the guarded path at all. PayPal serves
    // both from api-m.paypal.com, so there the two legitimately coincide.
    const { dataHost, tokenHost } = OAUTH_PROVIDERS[key];
    expect(companion!.allowedHosts).toEqual([dataHost]);
    if (tokenHost !== dataHost) expect(companion!.allowedHosts).not.toContain(tokenHost);
  });

  it.each(providers)('%s is a registered ref source, so the companion can resolve', (key) => {
    expect(listRefSources().map((r) => r.key)).toContain(key);
  });

  it.each(providers)('%s asks for every field oauth-refresh requires', (key) => {
    const keys = CREDENTIAL_REQUEST_SPECS[key].fields.map((f) => f.key);
    expect(keys).toContain('client_id');
    expect(keys).toContain('client_secret');
    // Only the refresh_token grant needs one; client_credentials must not ask.
    if (key === 'truelayer') expect(keys).toContain('refresh_token');
    // A credential set is stored as one JSON blob — that is the shape
    // `StoredOAuthCredential` is parsed out of.
    expect(CREDENTIAL_REQUEST_SPECS[key].assemble).toBe('json');
  });
});

describe('the vault handle cannot collide with the ref handle', () => {
  it.each(providers)('%s uses two distinct handles', (key) => {
    // They share a row if these ever match, and the ref write would blank the
    // stored value (`source: ref` sets payloadEnc = null).
    expect(OAUTH_PROVIDERS[key].vaultHandle).not.toBe(key);
  });
});
