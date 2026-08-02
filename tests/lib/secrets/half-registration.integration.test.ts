// Integration test for the half-registration guard — hits the REAL local DB and
// the REAL AES-256-GCM crypto. Not part of the default suite (it needs
// DATABASE_URL and INTEGRATION_CREDENTIALS_KEY). Run explicitly:
//   set -a; source .env; set +a; npx vitest run tests/lib/secrets/half-registration.integration.test.ts
//
// What it pins: an OAuth provider's `<provider>` ref row cannot exist without
// the `<provider>-oauth` vault row it mints access tokens from, in EITHER
// direction — you cannot create the ref row first, and you cannot delete the
// vault row out from under it.
//
// This is the 2026-08-02 outage written down. A migration created the
// `truelayer` and `paypal` ref rows by direct SQL and left the vault halves to
// be entered by hand. They never were; nothing surfaced it; the
// daily-spend-summary canvas failed on a cron for a day with "no credential
// stored". Note that raw SQL still bypasses this — the guard is on
// `upsertSecret`, which is the point: registry rows go through the code path.
//
// The guard keys off the REAL provider handles, so the test uses them and bails
// out rather than clobbering a host where the credential is genuinely set up.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { upsertSecret, getSecretMeta, deleteSecret, SecretError } from '$lib/secrets/registry';
import { OAUTH_PROVIDERS } from '$lib/secrets/oauth-refresh';

const REF = 'truelayer';
const VAULT = OAUTH_PROVIDERS.truelayer.vaultHandle; // truelayer-oauth
const TOKEN_HOST = OAUTH_PROVIDERS.truelayer.tokenHost;
const DATA_HOST = OAUTH_PROVIDERS.truelayer.dataHost;

/** A credential set carrying a not-yet-expired cached access token, so
 *  `getOAuthAccessToken` returns from cache and the test makes NO network call
 *  to TrueLayer. Without this, saving the ref row attempts a real token
 *  exchange with junk credentials. */
const FAKE_SET = JSON.stringify({
  client_id: 'test-client-id',
  client_secret: 'test-client-secret',
  refresh_token: 'test-refresh-token',
  access_token: 'test-access-token-9999',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
});

let live = false;

beforeAll(async () => {
  live = !!(await getSecretMeta(REF)) || !!(await getSecretMeta(VAULT));
  if (live) {
    console.warn(
      `[half-registration] SKIPPING — "${REF}"/"${VAULT}" already exist on this host and the ` +
        `guard keys off those exact handles. Refusing to touch a real credential.`,
    );
  }
});

afterAll(async () => {
  if (live) return;
  // Ref row first: deleting the vault row while the ref row exists is the very
  // thing the guard refuses.
  await deleteSecret(REF).catch(() => false);
  await deleteSecret(VAULT).catch(() => false);
});

const vaultRow = () =>
  upsertSecret({
    handle: VAULT,
    label: 'Half-registration test — credential set',
    source: 'vault',
    value: FAKE_SET,
    injection: { kind: 'none' },
    allowedHosts: [TOKEN_HOST],
    allowedMethods: ['POST'],
  });

const refRow = () =>
  upsertSecret({
    handle: REF,
    label: 'Half-registration test — token',
    source: 'ref',
    refKey: 'truelayer',
    injection: { kind: 'bearer' },
    allowedHosts: [DATA_HOST],
    allowedMethods: ['GET', 'HEAD'],
    allowedPathPrefixes: ['/data/v1'],
  });

describe('an OAuth ref row cannot be created before its credential set', () => {
  it('refuses the ref row, naming the row that has to come first', async () => {
    if (live) return;
    await expect(refRow()).rejects.toThrow(SecretError);
    await expect(refRow()).rejects.toThrow(VAULT);
    // And nothing was written — a refused save must not leave a partial row.
    expect(await getSecretMeta(REF)).toBeNull();
  });

  it('refuses when the vault row exists but holds no value', async () => {
    if (live) return;
    // A `ref` row for a DIFFERENT source is how you get a valueless row under
    // the vault handle without going near the crypto.
    await upsertSecret({
      handle: VAULT,
      label: 'Half-registration test — valueless',
      source: 'ref',
      refKey: 'openrouter',
      injection: { kind: 'bearer' },
      allowedHosts: ['openrouter.ai'],
      allowedMethods: ['GET', 'HEAD'],
    });
    await expect(refRow()).rejects.toThrow(/no value stored/);
    await deleteSecret(VAULT);
  });

  it('accepts the ref row once the credential set is stored', async () => {
    if (live) return;
    await vaultRow();
    const meta = await refRow();
    expect(meta.handle).toBe(REF);
    expect(meta.source).toBe('ref');
    // Resolved from the cached access token in FAKE_SET — no network call.
    expect(meta.available).toBe(true);
    expect(meta.hint).toBe('9999');
  });
});

describe('the credential set cannot be deleted out from under its ref row', () => {
  it('refuses the delete while the ref row is still registered', async () => {
    if (live) return;
    // Precondition from the previous block: both rows exist.
    expect(await getSecretMeta(REF)).not.toBeNull();
    await expect(deleteSecret(VAULT)).rejects.toThrow(SecretError);
    await expect(deleteSecret(VAULT)).rejects.toThrow(REF);
    expect(await getSecretMeta(VAULT)).not.toBeNull();
  });

  it('allows it once the ref row is gone', async () => {
    if (live) return;
    expect(await deleteSecret(REF)).toBe(true);
    expect(await deleteSecret(VAULT)).toBe(true);
    expect(await getSecretMeta(VAULT)).toBeNull();
  });
});

describe('non-OAuth ref sources are unaffected', () => {
  const PLAIN = 'test-halfreg-plain-ref';
  afterAll(async () => {
    await deleteSecret(PLAIN).catch(() => false);
  });

  it('a ref row with no companion concept saves normally', async () => {
    // The guard must not become "every ref row needs a vault row" — openrouter
    // resolves from keys.json and has no credential set at all.
    const meta = await upsertSecret({
      handle: PLAIN,
      label: 'Half-registration test — plain ref',
      source: 'ref',
      refKey: 'openrouter',
      injection: { kind: 'bearer' },
      allowedHosts: ['openrouter.ai'],
      allowedMethods: ['GET', 'HEAD'],
    });
    expect(meta.refKey).toBe('openrouter');
  });

  it('deleting it is not blocked', async () => {
    expect(await deleteSecret(PLAIN)).toBe(true);
  });
});
