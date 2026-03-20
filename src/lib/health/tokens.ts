import { db } from '$lib/db';
import { oauthTokens } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { refreshStravaToken } from './strava';
import { refreshWhoopToken } from './whoop';

export async function getValidToken(service: 'strava' | 'whoop'): Promise<string | null> {
  const [token] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.service, service))
    .limit(1);

  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const isExpired = token.expiresAt ? token.expiresAt < now + 60 : false; // 60s buffer

  if (!isExpired) return token.accessToken ?? null;
  if (!token.refreshToken) return null;

  try {
    let newTokens;
    if (service === 'strava') {
      newTokens = await refreshStravaToken(token.refreshToken);
      await db
        .update(oauthTokens)
        .set({
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token,
          expiresAt: newTokens.expires_at,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(oauthTokens.service, 'strava'));
      return newTokens.access_token;
    } else {
      newTokens = await refreshWhoopToken(token.refreshToken);
      const expiresAt = Math.floor(Date.now() / 1000) + newTokens.expires_in;
      await db
        .update(oauthTokens)
        .set({
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token || token.refreshToken,
          expiresAt,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(oauthTokens.service, 'whoop'));
      return newTokens.access_token;
    }
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
  // Upsert — delete existing then insert
  await db.delete(oauthTokens).where(eq(oauthTokens.service, service));
  await db.insert(oauthTokens).values({
    service,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken || '',
    expiresAt: data.expiresAt || null,
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
