import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { gmailAccounts, type GmailAccount } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptToken, decryptToken } from './crypto';
import type { GmailMessage, GmailAttachmentRef, SendInput, SendResult } from './types';

const CLOCK_SKEW_MS = 60_000; // refresh 60s before expiry

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function b64urlDecode(s: string | undefined | null): string {
  if (!s) return '';
  return Buffer.from(s, 'base64url').toString('utf8');
}

function headerLookup(
  headers: Array<{ name?: string | null; value?: string | null }> = [],
  name: string,
): string {
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function walkParts(
  part: any, // gmail_v1.Schema$MessagePart
  out: { text: string[]; html: string[]; attachments: GmailAttachmentRef[] },
): void {
  if (!part) return;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    out.text.push(b64urlDecode(part.body.data));
  } else if (part.mimeType === 'text/html' && part.body?.data) {
    out.html.push(b64urlDecode(part.body.data));
  } else if (part.body?.attachmentId && part.filename) {
    out.attachments.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      sizeBytes: part.body.size ?? 0,
    });
  }
  for (const p of part.parts ?? []) walkParts(p, out);
}

function buildRfc822(from: string, input: SendInput): string {
  const domain = from.split('@')[1] || 'local';
  const id = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`;
  const headers: string[] = [
    `From: ${from}`,
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    ...(input.bcc ? [`Bcc: ${input.bcc}`] : []),
    `Subject: ${input.subject}`,
    `Message-ID: ${id}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    'MIME-Version: 1.0',
  ];
  let body: string;
  if (input.bodyHtml && input.bodyText) {
    const boundary = `bnd_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      input.bodyText,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      input.bodyHtml,
      `--${boundary}--`,
    ].join('\r\n');
  } else if (input.bodyHtml) {
    headers.push('Content-Type: text/html; charset="UTF-8"');
    body = input.bodyHtml;
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    body = input.bodyText ?? '';
  }
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class GmailService {
  private clients = new Map<number, OAuth2Client>();

  private buildClient(): OAuth2Client {
    const OAuth2 = google.auth.OAuth2 as any;
    return new OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, undefined);
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

  // -------------------------------------------------------------------------
  // Fetch / parse a single message
  // -------------------------------------------------------------------------

  async fetchMessage(account: GmailAccount, messageId: string): Promise<GmailMessage> {
    const oauth = await this.getAuthenticatedClient(account);
    const gmail = this.gmailClientFor(oauth);
    const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const data = res.data;
    const payload = data.payload ?? {};
    const rawHeaders = payload.headers ?? [];

    const out = { text: [] as string[], html: [] as string[], attachments: [] as GmailAttachmentRef[] };

    // Top-level body (single-part messages)
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      out.text.push(b64urlDecode(payload.body.data));
    } else if (payload.mimeType === 'text/html' && payload.body?.data) {
      out.html.push(b64urlDecode(payload.body.data));
    }

    // Recurse into parts
    for (const p of payload.parts ?? []) walkParts(p, out);

    return {
      id: data.id ?? '',
      threadId: data.threadId ?? '',
      labelIds: data.labelIds ?? [],
      snippet: data.snippet ?? '',
      historyId: data.historyId ?? '',
      internalDate: data.internalDate ?? '',
      headers: {
        from: headerLookup(rawHeaders, 'from'),
        to: headerLookup(rawHeaders, 'to'),
        cc: headerLookup(rawHeaders, 'cc') || undefined,
        subject: headerLookup(rawHeaders, 'subject'),
        date: headerLookup(rawHeaders, 'date'),
        messageId: headerLookup(rawHeaders, 'message-id') || undefined,
        inReplyTo: headerLookup(rawHeaders, 'in-reply-to') || undefined,
        references: headerLookup(rawHeaders, 'references') || undefined,
      },
      bodyText: out.text.join(''),
      bodyHtml: out.html.join(''),
      attachments: out.attachments,
    };
  }

  // -------------------------------------------------------------------------
  // List message ids matching a query
  // -------------------------------------------------------------------------

  async listMessages(account: GmailAccount, query: string, max = 50): Promise<string[]> {
    const oauth = await this.getAuthenticatedClient(account);
    const gmail = this.gmailClientFor(oauth);
    const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: max });
    return (res.data.messages ?? []).map((m: any) => m.id as string).filter(Boolean);
  }

  // -------------------------------------------------------------------------
  // History list since a given historyId
  // -------------------------------------------------------------------------

  async historyListSince(
    account: GmailAccount,
    startHistoryId: string,
  ): Promise<{ addedMessageIds: string[]; newHistoryId: string }> {
    const oauth = await this.getAuthenticatedClient(account);
    const gmail = this.gmailClientFor(oauth);
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
      maxResults: 500,
    });
    const history = res.data.history ?? [];
    const addedMessageIds: string[] = [];
    for (const entry of history) {
      for (const added of entry.messagesAdded ?? []) {
        if (added.message?.id) addedMessageIds.push(added.message.id);
      }
    }
    const newHistoryId = res.data.historyId ?? startHistoryId;
    return { addedMessageIds, newHistoryId };
  }

  // -------------------------------------------------------------------------
  // Get the current historyId for an account
  // -------------------------------------------------------------------------

  async getLatestHistoryId(account: GmailAccount): Promise<string> {
    const oauth = await this.getAuthenticatedClient(account);
    const gmail = this.gmailClientFor(oauth);
    const res = await gmail.users.getProfile({ userId: 'me' });
    return res.data.historyId ?? '';
  }

  // -------------------------------------------------------------------------
  // Send a message
  // -------------------------------------------------------------------------

  async sendMessage(account: GmailAccount, input: SendInput): Promise<SendResult> {
    const oauth = await this.getAuthenticatedClient(account);
    const gmail = this.gmailClientFor(oauth);
    const raw = Buffer.from(buildRfc822(account.email, input)).toString('base64url');
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: input.threadId },
    });
    const messageId = res.data.id ?? '';
    const threadId = res.data.threadId ?? '';

    // Best-effort: retrieve the RFC822 Message-ID header from the sent message.
    // This is optional — callers that need it can call fetchMessage separately.
    // We skip it here to avoid extra API round-trips in the hot path.
    const rfc822MessageId = '';

    return { messageId, threadId, rfc822MessageId };
  }

  // -------------------------------------------------------------------------
  // Modify labels on a message
  // -------------------------------------------------------------------------

  async modifyLabels(
    account: GmailAccount,
    messageId: string,
    add: string[],
    remove: string[],
  ): Promise<void> {
    const oauth = await this.getAuthenticatedClient(account);
    const gmail = this.gmailClientFor(oauth);
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: add, removeLabelIds: remove },
    });
  }
}

export const gmailService = new GmailService();
