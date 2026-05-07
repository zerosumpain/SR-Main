import type { IntegrationCredentialRow } from '$lib/db/schema';

export type CredentialKind = 'apikey' | 'basic' | 'oauth2';

export type CredentialPayload<K extends CredentialKind = CredentialKind> =
  K extends 'apikey'
    ? { key: string }
    : K extends 'basic'
      ? { username: string; password: string }
      : K extends 'oauth2'
        ? {
            accessToken: string;
            refreshToken: string;
            expiresAt: number; // unix epoch ms
            scopes?: string[];
          }
        : never;

/** Decrypted-and-typed view of a row. */
export type IntegrationCredential<K extends CredentialKind = CredentialKind> =
  Omit<IntegrationCredentialRow, 'payloadEnc' | 'kind'> & {
    kind: K;
    payload: CredentialPayload<K>;
  };

/** Adapter for one specific integration type (e.g. 'apple-calendar'). */
export interface IntegrationAdapter {
  integrationType: string;
  /** Optional. Required if `kind === 'oauth2'`. */
  oauthSpec?: {
    authorizationUrl: string;
    tokenUrl: string;
    defaultScopes: string[];
    clientIdEnvVar: string;
    clientSecretEnvVar: string;
    /** Build extra query params for the auth-url (e.g. PKCE, response_type). */
    extraAuthParams?: () => Record<string, string>;
  };
  /**
   * Resolves dropdown options for a `resource-picker` widget.
   * Called from /api/integrations/options/[integrationType]/[fieldName].
   * Returns an array of `{ value, label }`.
   */
  resolveOptions?: (
    fieldName: string,
    credentialId: string,
  ) => Promise<{ value: string; label: string }[]>;
  /**
   * Health-check. Called from /api/integrations/test/[integrationType].
   * Resolves on success; rejects with a human-readable error message
   * if the credential is invalid / expired / unreachable.
   */
  testCredential?: (credentialId: string) => Promise<void>;
}
