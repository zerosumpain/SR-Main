import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { gmailAccounts, type GmailAccount } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptToken, decryptToken } from './crypto';

const CLOCK_SKEW_MS = 60_000; // refresh 60s before expiry

export class GmailService {
  private clients = new Map<number, OAuth2Client>();

  private buildClient(): OAuth2Client {
    const OAuth2 = google.auth.OAuth2 as any;
    // Call as factory to support both the real googleapis constructor and
    // vi.fn() arrow-function mocks used in tests.
    const args = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, undefined];
    try {
      return new OAuth2(...args);
    } catch {
      return OAuth2(...args);
    }
  }

  async getAuthenticatedClient(account: GmailAccount): Promise<OAuth2Client> {
    let client = this.clients.get(account.id);
    if (!client) {
      client = this.buildClient();
      this.clients.set(account.id, client);
    }

    const refreshToken = decryptToken(account.refreshTokenEnc);
    const needsRefresh =
      !account.accessTokenEnc ||
      !account.accessTokenExpiresAt ||
      account.accessTokenExpiresAt.getTime() - Date.now() < CLOCK_SKEW_MS;

    if (!needsRefresh && account.accessTokenEnc) {
      client.setCredentials({
        access_token: decryptToken(account.accessTokenEnc),
        refresh_token: refreshToken,
        expiry_date: account.accessTokenExpiresAt!.getTime(),
      });
      return client;
    }

    client.setCredentials({ refresh_token: refreshToken });
    try {
      const { credentials } = await client.refreshAccessToken();
      if (!credentials.access_token || !credentials.expiry_date) {
        throw new Error('Refresh returned no access_token/expiry_date');
      }
      await db
        .update(gmailAccounts)
        .set({
          accessTokenEnc: encryptToken(credentials.access_token),
          accessTokenExpiresAt: new Date(credentials.expiry_date),
          status: 'active',
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(gmailAccounts.id, account.id));
      client.setCredentials(credentials);
      return client;
    } catch (err: any) {
      const code = err?.response?.data?.error || err?.message || 'refresh_failed';
      await db
        .update(gmailAccounts)
        .set({
          status: code === 'invalid_grant' ? 'auth_expired' : 'active',
          lastError: String(code).slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(gmailAccounts.id, account.id));
      throw new Error(`Gmail token refresh failed: ${code}`);
    }
  }

  gmailClientFor(oauth: OAuth2Client): gmail_v1.Gmail {
    return google.gmail({ version: 'v1', auth: oauth });
  }
}

export const gmailService = new GmailService();
