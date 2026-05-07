import { db } from '$lib/db';
import { integrationCredentials } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptPayload, decryptPayload } from './crypto';
import { getIntegrationAdapter } from './registry';
import type {
  CredentialKind,
  CredentialPayload,
  IntegrationCredential,
} from './types';

interface CreateInput<K extends CredentialKind> {
  integrationType: string;
  label: string;
  kind: K;
  payload: CredentialPayload<K>;
  metadata?: Record<string, unknown>;
}

export async function createCredential<K extends CredentialKind>(
  input: CreateInput<K>,
): Promise<string> {
  const id = crypto.randomUUID();
  const payloadEnc = encryptPayload(JSON.stringify(input.payload));
  const now = new Date();
  await db.insert(integrationCredentials).values({
    id,
    integrationType: input.integrationType,
    label: input.label,
    kind: input.kind,
    payloadEnc,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function getCredential<K extends CredentialKind = CredentialKind>(
  id: string,
): Promise<IntegrationCredential<K> | null> {
  const rows = await db
    .select()
    .from(integrationCredentials)
    .where(eq(integrationCredentials.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  const payload = JSON.parse(decryptPayload(row.payloadEnc)) as CredentialPayload<K>;
  return {
    id: row.id,
    integrationType: row.integrationType,
    label: row.label,
    kind: row.kind as K,
    metadata: row.metadata,
    lastTestedAt: row.lastTestedAt,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    payload,
  };
}

/** Returns row-level metadata only, never decrypted payloads. */
export async function listCredentials(integrationType?: string) {
  const q = db.select({
    id: integrationCredentials.id,
    integrationType: integrationCredentials.integrationType,
    label: integrationCredentials.label,
    kind: integrationCredentials.kind,
    metadata: integrationCredentials.metadata,
    lastTestedAt: integrationCredentials.lastTestedAt,
    lastTestStatus: integrationCredentials.lastTestStatus,
    lastTestError: integrationCredentials.lastTestError,
    createdAt: integrationCredentials.createdAt,
    updatedAt: integrationCredentials.updatedAt,
  }).from(integrationCredentials);
  if (integrationType) {
    return q.where(eq(integrationCredentials.integrationType, integrationType));
  }
  return q;
}

interface UpdateInput {
  label?: string;
  payload?: CredentialPayload;
  metadata?: Record<string, unknown>;
  lastTestedAt?: Date;
  lastTestStatus?: 'ok' | 'failed' | null;
  lastTestError?: string | null;
}

export async function updateCredential(id: string, patch: UpdateInput): Promise<void> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.payload !== undefined) update.payloadEnc = encryptPayload(JSON.stringify(patch.payload));
  if (patch.metadata !== undefined) update.metadata = patch.metadata;
  if (patch.lastTestedAt !== undefined) update.lastTestedAt = patch.lastTestedAt;
  if (patch.lastTestStatus !== undefined) update.lastTestStatus = patch.lastTestStatus;
  if (patch.lastTestError !== undefined) update.lastTestError = patch.lastTestError;
  await db.update(integrationCredentials).set(update).where(eq(integrationCredentials.id, id));
}

export async function deleteCredential(id: string): Promise<void> {
  await db.delete(integrationCredentials).where(eq(integrationCredentials.id, id));
}

const REFRESH_BUFFER_MS = 60 * 1000; // refresh 1 minute before expiry

export async function ensureFreshAccessToken(id: string): Promise<string> {
  const cred = await getCredential<'oauth2'>(id);
  if (!cred) throw new Error(`Credential not found: ${id}`);
  if (cred.kind !== 'oauth2') {
    throw new Error(`Credential ${id} is not oauth2 (kind=${cred.kind})`);
  }
  const expiresAt = cred.payload.expiresAt;
  if (Date.now() < expiresAt - REFRESH_BUFFER_MS) {
    return cred.payload.accessToken;
  }

  const adapter = getIntegrationAdapter(cred.integrationType);
  if (!adapter || !adapter.oauthSpec) {
    throw new Error(`No OAuth adapter for ${cred.integrationType}`);
  }
  const clientId = process.env[adapter.oauthSpec.clientIdEnvVar];
  const clientSecret = process.env[adapter.oauthSpec.clientSecretEnvVar];
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing ${adapter.oauthSpec.clientIdEnvVar} or ${adapter.oauthSpec.clientSecretEnvVar} env var`,
    );
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cred.payload.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(adapter.oauthSpec.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  const newPayload = {
    accessToken: json.access_token as string,
    refreshToken: (json.refresh_token as string | undefined) ?? cred.payload.refreshToken,
    expiresAt: Date.now() + (Number(json.expires_in) * 1000),
    scopes: cred.payload.scopes,
  };
  await updateCredential(id, { payload: newPayload });
  return newPayload.accessToken;
}
