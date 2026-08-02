// src/lib/secrets/oauth-refresh.ts
//
// Server-side OAuth2 token exchange for the secret registry.
//
// WHY THIS EXISTS
// ---------------
// The registry can inject a credential as a bearer/header/query value, but some
// APIs don't hand you a long-lived key — they hand you a client_id/client_secret
// (+ maybe a refresh_token) and expect you to trade those for a short-lived
// access token before every session. TrueLayer (refresh_token grant) and PayPal
// (client_credentials grant) are both like that.
//
// Before this module the only way to use such an API from the canvas was a
// `code-execute` node with the credentials pasted into the Python body. That
// puts a live secret in `workflow_nodes.config` — unencrypted in the DB,
// rendered in the canvas UI, echoed into healing prompts, and serialised into
// the LLM prompt on every build. On 2026-08-01 that leaked a TrueLayer
// client_secret + bank refresh_token and a PayPal client_secret into seven
// production tables. See the `jkai-canvas` skill for the standing rule.
//
// THE SHAPE
// ---------
// A REF_SOURCES entry is resolved on EVERY request (registry.ts `resolveValue`),
// so `resolve()` is already the right place for a call-time token exchange —
// no new injection kind, no schema change, no new node type. Each provider gets
// two rows in `api_secrets`:
//
//   <provider>-oauth   source=vault   payload = JSON credential set (encrypted)
//   <provider>         source=ref     ref_key=<provider>, injection={kind:'bearer'}
//                                     allowed_hosts pinned to the DATA host only
//
// The vault row is a credential *store* and is never injected into a request
// (its allowedHosts stay empty). The ref row is what nodes reference; resolving
// it runs the exchange below and yields a fresh access token. The token
// endpoint is called by this module directly, so it never needs to appear in
// any secret's allowedHosts — the guarded path only ever sees the data host.
//
// Rotated refresh tokens are written back into the vault row's encrypted
// payload. TrueLayer rotates on every refresh; dropping the new token silently
// bricks the connection a few weeks later, which is the classic failure here.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { apiSecrets } from '$lib/db/schema';
import { decryptPayload, encryptPayload } from '$lib/integrations/crypto';

/** Seconds of headroom before expiry at which we proactively refresh. */
const EXPIRY_BUFFER_S = 60;

/** Providers that trade stored credentials for a short-lived access token. */
export type OAuthProvider = 'truelayer' | 'paypal';

export const OAUTH_PROVIDERS: Record<
  OAuthProvider,
  { label: string; vaultHandle: string; tokenUrl: string; dataHost: string }
> = {
  truelayer: {
    label: 'TrueLayer access token (refresh_token grant, auto-rotating)',
    vaultHandle: 'truelayer-oauth',
    tokenUrl: 'https://auth.truelayer.com/connect/token',
    dataHost: 'api.truelayer.com',
  },
  paypal: {
    label: 'PayPal access token (client_credentials grant)',
    vaultHandle: 'paypal-oauth',
    tokenUrl: 'https://api-m.paypal.com/v1/oauth2/token',
    dataHost: 'api-m.paypal.com',
  },
};

/**
 * What we keep in the vault row's encrypted payload. `access_token` /
 * `expires_at` are a cache: losing them costs one extra exchange, nothing more.
 */
interface StoredOAuthCredential {
  client_id: string;
  client_secret: string;
  /** Required for the refresh_token grant; absent for client_credentials. */
  refresh_token?: string;
  access_token?: string;
  /** Unix seconds. */
  expires_at?: number;
}

export class OAuthRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthRefreshError';
  }
}

async function readCredential(provider: OAuthProvider): Promise<StoredOAuthCredential> {
  const { vaultHandle } = OAUTH_PROVIDERS[provider];
  const [row] = await db.select().from(apiSecrets).where(eq(apiSecrets.handle, vaultHandle)).limit(1);

  if (!row) {
    throw new OAuthRefreshError(
      `no credential stored for "${provider}" — add the "${vaultHandle}" secret at /admin/ai/apis`,
    );
  }
  if (!row.payloadEnc) {
    throw new OAuthRefreshError(`secret "${vaultHandle}" has no stored value`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptPayload(row.payloadEnc));
  } catch {
    throw new OAuthRefreshError(
      `secret "${vaultHandle}" could not be decrypted or is not JSON on this host ` +
        `(INTEGRATION_CREDENTIALS_KEY differs between homeserv and the VPS?). Re-enter it here.`,
    );
  }

  const cred = parsed as StoredOAuthCredential;
  if (!cred?.client_id || !cred?.client_secret) {
    throw new OAuthRefreshError(
      `secret "${vaultHandle}" must be a JSON object with at least client_id and client_secret`,
    );
  }
  return cred;
}

/** Persist the (possibly rotated) credential set back into the vault row. */
async function writeCredential(provider: OAuthProvider, cred: StoredOAuthCredential): Promise<void> {
  const { vaultHandle } = OAUTH_PROVIDERS[provider];
  await db
    .update(apiSecrets)
    .set({
      payloadEnc: encryptPayload(JSON.stringify(cred)),
      // `hint` is shown in the admin list for identification. Keep it pointing at
      // the durable half of the credential, never the rotating access token.
      hint: cred.client_id.slice(-4),
      updatedAt: new Date(),
    })
    .where(eq(apiSecrets.handle, vaultHandle));
}

/**
 * POST the token endpoint form-encoded. Deliberately a bare `fetch`, not the
 * guarded catalogue path: the URL is a fixed constant in OAUTH_PROVIDERS, not
 * caller-supplied, so there is nothing for an SSRF guard to protect against —
 * and routing it through the guard would require adding the auth host to a
 * secret's allowedHosts, widening the data credential's reach.
 */
async function exchange(
  provider: OAuthProvider,
  form: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<{ access_token: string; expires_in?: number; refresh_token?: string }> {
  const { tokenUrl } = OAUTH_PROVIDERS[provider];

  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        ...extraHeaders,
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new OAuthRefreshError(`${provider} token endpoint unreachable: ${(e as Error).message}`);
  }

  const text = await res.text();
  if (!res.ok) {
    // The body can echo the client_secret back on some errors — never surface it.
    const safe = /invalid_grant/.test(text)
      ? 'invalid_grant (the stored refresh token is expired or revoked — re-authorise at /admin/ai/apis)'
      : `HTTP ${res.status}`;
    throw new OAuthRefreshError(`${provider} token exchange failed: ${safe}`);
  }

  let json: { access_token?: string; expires_in?: number; refresh_token?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new OAuthRefreshError(`${provider} token endpoint returned a non-JSON body`);
  }
  if (!json.access_token) {
    throw new OAuthRefreshError(`${provider} token endpoint returned no access_token`);
  }
  return json as { access_token: string; expires_in?: number; refresh_token?: string };
}

/**
 * In-flight de-duplication. Several nodes in one run can resolve the same
 * handle concurrently; without this each would start its own exchange and the
 * losers would persist a refresh token that the winner has already rotated
 * away — which is exactly how a rotating credential gets bricked.
 */
const inFlight = new Map<OAuthProvider, Promise<string>>();

async function refreshNow(provider: OAuthProvider): Promise<string> {
  const cred = await readCredential(provider);

  const result =
    provider === 'truelayer'
      ? await (async () => {
          if (!cred.refresh_token) {
            throw new OAuthRefreshError(
              'truelayer credential has no refresh_token — re-authorise and store the new one',
            );
          }
          return exchange('truelayer', {
            grant_type: 'refresh_token',
            client_id: cred.client_id,
            client_secret: cred.client_secret,
            refresh_token: cred.refresh_token,
          });
        })()
      : await exchange(
          'paypal',
          { grant_type: 'client_credentials' },
          {
            Authorization: `Basic ${Buffer.from(`${cred.client_id}:${cred.client_secret}`).toString('base64')}`,
          },
        );

  const next: StoredOAuthCredential = {
    ...cred,
    access_token: result.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (result.expires_in ?? 3600),
    // TrueLayer rotates the refresh token on every exchange. Keep the old one if
    // the provider didn't issue a new one (PayPal never does).
    refresh_token: result.refresh_token ?? cred.refresh_token,
  };
  await writeCredential(provider, next);

  return result.access_token;
}

/**
 * Return a valid access token for `provider`, exchanging only when the cached
 * one is missing or within {@link EXPIRY_BUFFER_S} of expiry.
 *
 * Throws {@link OAuthRefreshError} with an owner-actionable message on failure —
 * the registry surfaces it as the secret being unavailable rather than silently
 * issuing an unauthenticated request. Never returns or logs a client_secret.
 */
export async function getOAuthAccessToken(provider: OAuthProvider): Promise<string> {
  const existing = inFlight.get(provider);
  if (existing) return existing;

  const run = (async () => {
    const cred = await readCredential(provider);
    const now = Math.floor(Date.now() / 1000);
    if (cred.access_token && cred.expires_at && cred.expires_at > now + EXPIRY_BUFFER_S) {
      return cred.access_token;
    }
    return refreshNow(provider);
  })().finally(() => inFlight.delete(provider));

  inFlight.set(provider, run);
  return run;
}
