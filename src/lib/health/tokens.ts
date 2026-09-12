import { db } from '$lib/db';
import { oauthTokens } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { refreshStravaToken } from './strava';
import { refreshWhoopToken } from './whoop';

type HealthService = 'strava' | 'whoop';
const pendingTokens = new Map<HealthService, Promise<string | null>>();

/** Coalesce callers in this process; the transaction lock also covers other workers. */
export function getValidToken(service: HealthService): Promise<string | null> {
  const pending = pendingTokens.get(service);
  if (pending) return pending;
  const request = readOrRefreshToken(service).finally(() => pendingTokens.delete(service));
  pendingTokens.set(service, request);
  return request;
}

function needsRefresh(expiresAt: number | null): boolean {
  return expiresAt !== null && expiresAt < Math.floor(Date.now() / 1000) + 60;
}

async function readOrRefreshToken(service: HealthService): Promise<string | null> {
  const [current] = await db.select().from(oauthTokens)
    .where(eq(oauthTokens.service, service)).limit(1);
  if (!current) return null;
  if (!needsRefresh(current.expiresAt)) return current.accessToken ?? null;

  try {
    return await db.transaction(async (tx) => {
      // Refreshing WHOOP invalidates the previous access token. Serialize the
      // exchange and its persistence, then re-read: another worker may have
      // refreshed while this caller waited. Reconnection uses the same lock.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`health-oauth:${service}`}))`);
      const [token] = await tx.select().from(oauthTokens)
        .where(eq(oauthTokens.service, service)).limit(1);
      if (!token) return null;
      if (!needsRefresh(token.expiresAt)) return token.accessToken ?? null;
      if (!token.refreshToken) return null;

      const newTokens = service === 'strava'
        ? await refreshStravaToken(token.refreshToken)
        : await refreshWhoopToken(token.refreshToken);
      const now = Math.floor(Date.now() / 1000);
      await tx.update(oauthTokens).set({
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token || token.refreshToken,
        expiresAt: 'expires_at' in newTokens ? newTokens.expires_at : now + newTokens.expires_in,
        updatedAt: now,
      }).where(eq(oauthTokens.id, token.id));
      return newTokens.access_token;
    });
  } catch (e) {
    console.error(`Failed to refresh ${service} token:`, e);
    return null;
  }
}

export async function storeTokens(
  service: 'strava' | 'whoop',
  data: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string;
  }
) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`health-oauth:${service}`}))`);
    await tx.delete(oauthTokens).where(eq(oauthTokens.service, service));
    await tx.insert(oauthTokens).values({
      service,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || '',
      expiresAt: data.expiresAt || null,
    });
  });
}

export async function hasToken(service: 'strava' | 'whoop'): Promise<boolean> {
  const [token] = await db
    .select({ id: oauthTokens.id })
    .from(oauthTokens)
    .where(eq(oauthTokens.service, service))
    .limit(1);
  return !!token;
}
