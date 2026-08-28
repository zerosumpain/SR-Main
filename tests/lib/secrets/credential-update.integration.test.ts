// Integration test for the credential UPDATE primitives — hits the REAL local
// DB and the REAL AES-256-GCM crypto. Not part of the default suite (it needs
// DATABASE_URL and INTEGRATION_CREDENTIALS_KEY). Run explicitly:
//   set -a; source .env; set +a; npx vitest run tests/lib/secrets/credential-update.integration.test.ts
//
// The unit tests around these functions mock `$lib/db`, so they prove the
// decision logic and nothing about the writes. This proves the half that
// actually touches a row:
//
//   1. rotating a value leaves the host binding EXACTLY as it was — the reason
//      updates do not go through `upsertSecret`, which rewrites it wholesale;
//   2. amending one field of a credential set keeps every other field, and the
//      merged blob is still decryptable and still the right shape;
//   3. a binding change moves the binding without touching the stored value;
//   4. none of them can be pointed at a `ref` row, or leave a row unbound.
//
// It creates its own throwaway handles and deletes them again, so it cannot
// disturb the live truelayer / paypal / openrouter rows.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  upsertSecret,
  getSecretMeta,
  deleteSecret,
  rotateSecretValue,
  amendSecretValueFields,
  updateSecretBinding,
  resolveSecretForUrl,
  SecretError,
} from '$lib/secrets/registry';

const SINGLE = 'test-update-single';
const FIELDSET = 'test-update-fieldset';
const REFROW = 'test-update-ref';

const HOST = 'api.company-information.service.gov.uk';

beforeAll(async () => {
  await upsertSecret({
    handle: SINGLE,
    label: 'Update test — single value',
    source: 'vault',
    value: 'original-value-0001',
    injection: { kind: 'bearer' },
    allowedHosts: [HOST],
    allowedMethods: ['GET', 'HEAD'],
    allowedPathPrefixes: ['/company'],
  });

  await upsertSecret({
    handle: FIELDSET,
    label: 'Update test — credential set',
    source: 'vault',
    value: JSON.stringify({
      client_id: 'client-id-original',
      client_secret: 'client-secret-original',
      refresh_token: 'refresh-token-original',
    }),
    injection: { kind: 'none' },
    allowedHosts: ['auth.truelayer.com'],
    allowedMethods: ['POST'],
  });

  await upsertSecret({
    handle: REFROW,
    label: 'Update test — ref row',
    source: 'ref',
    refKey: 'openrouter',
    injection: { kind: 'bearer' },
    allowedHosts: ['openrouter.ai'],
    allowedMethods: ['GET'],
  });
});

afterAll(async () => {
  for (const h of [SINGLE, FIELDSET, REFROW]) await deleteSecret(h).catch(() => {});
});

describe('rotateSecretValue', () => {
  it('replaces the value and leaves every binding field untouched', async () => {
    const before = (await getSecretMeta(SINGLE))!;
    const after = await rotateSecretValue(SINGLE, 'rotated-value-0002');

    // The whole point of a narrow primitive: nothing but the value moved.
    expect(after.allowedHosts).toEqual(before.allowedHosts);
    expect(after.allowedMethods).toEqual(before.allowedMethods);
    expect(after.allowedPathPrefixes).toEqual(before.allowedPathPrefixes);
    expect(after.injection).toEqual(before.injection);
    expect(after.label).toBe(before.label);
    expect(after.source).toBe(before.source);

    // The value really did change, evidenced without exposing it.
    expect(after.hint).toBe('0002');
    expect(before.hint).toBe('0001');
    expect(after.available).toBe(true);
  });

  it('the rotated value is the one actually injected', async () => {
    const resolved = await resolveSecretForUrl(SINGLE, `https://${HOST}/company/00000001`, 'GET');
    expect(resolved.headers.Authorization).toBe('Bearer rotated-value-0002');
    // And the binding still holds afterwards.
    await expect(resolveSecretForUrl(SINGLE, 'https://evil.example/company/1', 'GET')).rejects.toThrow(
      SecretError,
    );
  });

  it('refuses an empty value rather than blanking the credential', async () => {
    await expect(rotateSecretValue(SINGLE, '   ')).rejects.toThrow(SecretError);
    expect((await getSecretMeta(SINGLE))!.available).toBe(true);
  });

  it('refuses a handle that does not exist', async () => {
    await expect(rotateSecretValue('no-such-handle-here', 'x')).rejects.toThrow(/no secret registered/);
  });

  it('refuses a ref row and says where the value actually lives', async () => {
    await expect(rotateSecretValue(REFROW, 'x')).rejects.toThrow(/not stored in the registry/);
  });
});

describe('amendSecretValueFields', () => {
  it('changes one field and keeps the others', async () => {
    const before = (await getSecretMeta(FIELDSET))!;
    await amendSecretValueFields(FIELDSET, { refresh_token: 'refresh-token-ROTATED' });

    // Read the merged blob back the way oauth-refresh does, to prove the shape
    // survived and the untouched fields are still there verbatim.
    const { db } = await import('$lib/db');
    const { apiSecrets } = await import('$lib/db/schema');
    const { decryptPayload } = await import('$lib/secrets/crypto');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, FIELDSET)).limit(1);
    const parsed = JSON.parse(decryptPayload(row.payloadEnc!));

    expect(parsed).toEqual({
      client_id: 'client-id-original',
      client_secret: 'client-secret-original',
      refresh_token: 'refresh-token-ROTATED',
    });

    // Binding untouched, as with rotate.
    const after = (await getSecretMeta(FIELDSET))!;
    expect(after.allowedHosts).toEqual(before.allowedHosts);
    expect(after.injection).toEqual({ kind: 'none' });
  });

  it('refuses an empty patch instead of writing a no-op', async () => {
    await expect(amendSecretValueFields(FIELDSET, {})).rejects.toThrow(/no fields/);
    await expect(amendSecretValueFields(FIELDSET, { client_id: '   ' })).rejects.toThrow(/no fields/);
  });

  it('refuses to amend a single-value credential, without quoting it', async () => {
    let err: Error | null = null;
    try {
      await amendSecretValueFields(SINGLE, { client_id: 'x' });
    } catch (e) {
      err = e as Error;
    }
    expect(err, 'amending a single-value credential must throw').toBeTruthy();
    expect(err!.message).toMatch(/single value, not a multi-field set/);
    // The refusal must not quote any part of what is stored.
    expect(err!.message).not.toContain('rotated-value-0002');
  });
});

describe('updateSecretBinding', () => {
  it('moves the binding and leaves the stored value alone', async () => {
    const before = (await getSecretMeta(SINGLE))!;
    const after = await updateSecretBinding(SINGLE, {
      allowedHosts: [HOST, 'api-v2.example.com'],
      allowedMethods: ['GET', 'HEAD', 'POST'],
      allowedPathPrefixes: ['/company'],
    });

    expect(after.allowedHosts).toContain('api-v2.example.com');
    expect(after.allowedMethods).toContain('POST');
    // Value untouched: same hint, and it still resolves to the same plaintext.
    expect(after.hint).toBe(before.hint);
    const resolved = await resolveSecretForUrl(SINGLE, `https://${HOST}/company/1`, 'GET');
    expect(resolved.headers.Authorization).toBe('Bearer rotated-value-0002');
  });

  it('the new binding is enforced immediately, in both directions', async () => {
    await expect(
      resolveSecretForUrl(SINGLE, 'https://api-v2.example.com/company/1', 'GET'),
    ).resolves.toBeTruthy();
    // Path scoping survived the rebind.
    await expect(resolveSecretForUrl(SINGLE, `https://${HOST}/officers/1`, 'GET')).rejects.toThrow(
      SecretError,
    );
  });

  it('REGRESSION: refuses to leave a credential unbound', async () => {
    // An empty host list would mean "sendable anywhere", which is the one state
    // the whole registry exists to make unreachable.
    await expect(updateSecretBinding(SINGLE, { allowedHosts: [], allowedMethods: ['GET'], allowedPathPrefixes: [] }))
      .rejects.toThrow(/at least one allowed host/);
    expect((await getSecretMeta(SINGLE))!.allowedHosts.length).toBeGreaterThan(0);
  });

  it('cannot change injection, source or refKey — there is no parameter for them', async () => {
    const before = (await getSecretMeta(FIELDSET))!;
    await updateSecretBinding(FIELDSET, {
      allowedHosts: ['auth.truelayer.com'],
      allowedMethods: ['POST'],
      allowedPathPrefixes: [],
    });
    const after = (await getSecretMeta(FIELDSET))!;
    // Still store-only. If this ever flipped to bearer, resolving it would paste
    // the entire client_id + client_secret + refresh_token blob into a header.
    expect(after.injection).toEqual({ kind: 'none' });
    expect(after.source).toBe(before.source);
    await expect(resolveSecretForUrl(FIELDSET, 'https://auth.truelayer.com/connect/token', 'POST')).rejects.toThrow(
      /store-only/,
    );
  });
});
