import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityOauthTransactions } from '$lib/db/schema';
import { decryptPayload, encryptPayload } from '$lib/secrets/crypto';
import { randomActivityId } from '../store/ids';
import { createOauthState, createPkceVerifier, hashOauthState, pkceChallenge } from './pkce';

export const ACTIVITY_OAUTH_TTL_MS = 10 * 60 * 1000;

export class ActivityOauthError extends Error {
  constructor(
    readonly code: 'invalid_state' | 'expired_state' | 'replayed_state',
    message: string,
  ) {
    super(message);
    this.name = 'ActivityOauthError';
  }
}

export async function beginActivityOauthTransaction(input: {
  principalId: string;
  connectionId: string;
  provider: string;
  redirectPath: string;
  scopes: string[];
  now?: Date;
}): Promise<{ state: string; codeChallenge: string; expiresAt: Date }> {
  if (!input.redirectPath.startsWith('/') || input.redirectPath.startsWith('//')) {
    throw new Error('OAuth redirect path must be site-relative');
  }
  const now = input.now ?? new Date();
  const state = createOauthState();
  const verifier = createPkceVerifier();
  const expiresAt = new Date(now.getTime() + ACTIVITY_OAUTH_TTL_MS);
  await db.insert(activityOauthTransactions).values({
    id: randomActivityId('aoauth'),
    stateHash: hashOauthState(state),
    principalId: input.principalId,
    connectionId: input.connectionId,
    provider: input.provider,
    redirectPath: input.redirectPath,
    scopes: input.scopes,
    codeVerifierEnc: encryptPayload(verifier),
    expiresAt,
    createdAt: now,
  });
  return { state, codeChallenge: pkceChallenge(verifier), expiresAt };
}

/** Atomically marks state consumed before yielding its PKCE verifier. */
export async function consumeActivityOauthTransaction(input: {
  state: string;
  principalId: string;
  connectionId: string;
  provider: string;
  now?: Date;
}): Promise<{ codeVerifier: string; redirectPath: string; scopes: string[] }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT *
      FROM activity_oauth_transactions
      WHERE state_hash = ${hashOauthState(input.state)}
        AND principal_id = ${input.principalId}
        AND connection_id = ${input.connectionId}
        AND provider = ${input.provider}
      LIMIT 1
      FOR UPDATE
    `);
    const rows = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const row = rows[0];
    if (!row) throw new ActivityOauthError('invalid_state', 'OAuth state is unknown or mismatched');
    if (row.consumed_at) throw new ActivityOauthError('replayed_state', 'OAuth state was already used');
    // Raw `execute` rows carry timestamptz as a STRING, not a Date — the same
    // driver behaviour that broke the job queue's failure path. Coerce before
    // comparing, or every provider callback dies on `.getTime()`.
    const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at));
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      throw new ActivityOauthError('expired_state', 'OAuth state has expired');
    }
    await tx
      .update(activityOauthTransactions)
      .set({ consumedAt: now })
      .where(
        and(
          eq(activityOauthTransactions.id, String(row.id)),
          isNull(activityOauthTransactions.consumedAt),
        ),
      );
    return {
      codeVerifier: decryptPayload(String(row.code_verifier_enc)),
      redirectPath: String(row.redirect_path),
      scopes: (row.scopes ?? []) as string[],
    };
  });
}

export async function pruneActivityOauthTransactions(now = new Date()): Promise<number> {
  const rows = await db
    .delete(activityOauthTransactions)
    .where(lt(activityOauthTransactions.expiresAt, now))
    .returning({ id: activityOauthTransactions.id });
  return rows.length;
}
