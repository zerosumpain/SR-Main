import { register } from '../registry-internal';
import { db } from '$lib/db';
import { gmailAccounts, type GmailAccount } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { gmailService } from '$lib/workflows/gmail/service';

const MAX_BODY_CHARS = 4000;

const IMMUTABLE_SYSTEM_LABELS = new Set(['SENT', 'DRAFT', 'CHAT']);

async function resolveAccount(args: Record<string, unknown>): Promise<GmailAccount | { error: string }> {
  const rawId = args.accountId;
  const rawEmail = args.email;

  if (rawId !== undefined && rawId !== null && rawId !== '') {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) return { error: 'Invalid accountId' };
    const [acct] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, id)).limit(1);
    if (!acct) return { error: `Gmail account ${id} not found` };
    return acct;
  }

  if (typeof rawEmail === 'string' && rawEmail.length > 0) {
    const [acct] = await db
      .select()
      .from(gmailAccounts)
      .where(eq(gmailAccounts.email, rawEmail))
      .limit(1);
    if (!acct) return { error: `Gmail account "${rawEmail}" not found` };
    return acct;
  }

  // Default: most recently updated active account.
  const [acct] = await db
    .select()
    .from(gmailAccounts)
    .where(eq(gmailAccounts.status, 'active'))
    .orderBy(desc(gmailAccounts.updatedAt))
    .limit(1);
  if (!acct) {
    return {
      error:
        'No active Gmail accounts connected. Connect one at /admin/connections/gmail or pass accountId/email.',
    };
  }
  return acct;
}

function isAuthExpiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid_grant|auth_expired/i.test(msg);
}

function truncate(s: string, max = MAX_BODY_CHARS): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
}

register({
  name: 'gmail_list_accounts',
  description:
    'List connected Gmail accounts with id, email, status (active|auth_expired|disabled), and last error. Use this first to discover which mailbox to query, or to surface accounts that need re-connecting.',
  parameters: { type: 'object', properties: {} },
  category: 'Gmail',
  toolset: 'gmail',
  handler: async () => {
    const rows = await db
      .select({
        id: gmailAccounts.id,
        email: gmailAccounts.email,
        status: gmailAccounts.status,
        lastError: gmailAccounts.lastError,
        updatedAt: gmailAccounts.updatedAt,
      })
      .from(gmailAccounts)
      .orderBy(desc(gmailAccounts.updatedAt));
    return { success: true, data: rows };
  },
});

register({
  name: 'gmail_search',
  description:
    'Search Gmail messages using Gmail query syntax (from:, to:, subject:, label:, is:unread, newer_than:7d, has:attachment, etc.). Returns headers and snippets only — call gmail_get_message for full body. Defaults to the most recently used active account if accountId/email are omitted.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search query, e.g. "from:alice newer_than:7d is:unread"',
      },
      max: { type: 'number', description: 'Max results (default 20, hard cap 50)' },
      accountId: { type: 'number', description: 'Optional Gmail account id (see gmail_list_accounts)' },
      email: { type: 'string', description: 'Optional connected account email' },
    },
    required: ['query'],
  },
  category: 'Gmail',
  toolset: 'gmail',
  handler: async (args) => {
    const acct = await resolveAccount(args);
    if ('error' in acct) return { success: false, error: acct.error };
    if (acct.status === 'auth_expired') {
      return {
        success: false,
        error: `Account ${acct.email} needs re-authentication at /admin/connections/gmail.`,
      };
    }

    const query = String(args.query ?? '').trim();
    if (!query) return { success: false, error: 'query is required' };
    const max = Math.min(Number(args.max) || 20, 50);

    try {
      const ids = await gmailService.listMessages(acct, query, max);
      if (ids.length === 0) {
        return { success: true, data: { account: acct.email, query, count: 0, messages: [] } };
      }

      const messages = await Promise.all(
        ids.map(async (id) => {
          try {
            const m = await gmailService.fetchMessage(acct, id);
            return {
              id: m.id,
              threadId: m.threadId,
              labelIds: m.labelIds,
              snippet: m.snippet,
              from: m.headers.from,
              to: m.headers.to,
              subject: m.headers.subject,
              date: m.headers.date,
              hasAttachments: m.attachments.length > 0,
            };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }),
      );

      return {
        success: true,
        data: { account: acct.email, query, count: messages.length, messages },
      };
    } catch (err) {
      if (isAuthExpiredError(err)) {
        return {
          success: false,
          error: `Account ${acct.email} auth expired. Reconnect at /admin/connections/gmail.`,
        };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

register({
  name: 'gmail_get_message',
  description:
    'Fetch a full Gmail message by id — headers, body text (truncated to ~4 KB), labels, and attachment metadata. bodyHtml is omitted to keep responses small.',
  parameters: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'Gmail message id (from gmail_search results)' },
      accountId: { type: 'number', description: 'Optional account id' },
      email: { type: 'string', description: 'Optional account email' },
    },
    required: ['messageId'],
  },
  category: 'Gmail',
  toolset: 'gmail',
  handler: async (args) => {
    const acct = await resolveAccount(args);
    if ('error' in acct) return { success: false, error: acct.error };
    if (acct.status === 'auth_expired') {
      return {
        success: false,
        error: `Account ${acct.email} needs re-authentication at /admin/connections/gmail.`,
      };
    }

    const messageId = String(args.messageId ?? '').trim();
    if (!messageId) return { success: false, error: 'messageId is required' };

    try {
      const m = await gmailService.fetchMessage(acct, messageId);
      return {
        success: true,
        data: {
          account: acct.email,
          id: m.id,
          threadId: m.threadId,
          labelIds: m.labelIds,
          snippet: m.snippet,
          headers: m.headers,
          bodyText: truncate(m.bodyText),
          bodyTextLength: m.bodyText.length,
          attachments: m.attachments,
        },
      };
    } catch (err) {
      if (isAuthExpiredError(err)) {
        return {
          success: false,
          error: `Account ${acct.email} auth expired. Reconnect at /admin/connections/gmail.`,
        };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

register({
  name: 'gmail_get_thread',
  description:
    'Fetch all messages in a Gmail thread by threadId. Each message body is truncated to ~4 KB. Use after gmail_search to read the full conversation.',
  parameters: {
    type: 'object',
    properties: {
      threadId: { type: 'string', description: 'Gmail thread id' },
      accountId: { type: 'number', description: 'Optional account id' },
      email: { type: 'string', description: 'Optional account email' },
    },
    required: ['threadId'],
  },
  category: 'Gmail',
  toolset: 'gmail',
  handler: async (args) => {
    const acct = await resolveAccount(args);
    if ('error' in acct) return { success: false, error: acct.error };
    if (acct.status === 'auth_expired') {
      return {
        success: false,
        error: `Account ${acct.email} needs re-authentication at /admin/connections/gmail.`,
      };
    }

    const threadId = String(args.threadId ?? '').trim();
    if (!threadId) return { success: false, error: 'threadId is required' };

    try {
      const oauth = await gmailService.getAuthenticatedClient(acct);
      const gmail = gmailService.gmailClientFor(oauth);
      const res = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata' });
      const messageIds = (res.data.messages ?? []).map((m) => m.id ?? '').filter(Boolean);

      const messages = await Promise.all(
        messageIds.map(async (id) => {
          try {
            const m = await gmailService.fetchMessage(acct, id);
            return {
              id: m.id,
              labelIds: m.labelIds,
              snippet: m.snippet,
              headers: m.headers,
              bodyText: truncate(m.bodyText),
              bodyTextLength: m.bodyText.length,
              attachments: m.attachments,
            };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }),
      );

      return {
        success: true,
        data: { account: acct.email, threadId, count: messages.length, messages },
      };
    } catch (err) {
      if (isAuthExpiredError(err)) {
        return {
          success: false,
          error: `Account ${acct.email} auth expired. Reconnect at /admin/connections/gmail.`,
        };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

register({
  name: 'gmail_list_labels',
  description:
    'List Gmail labels for an account (system + user labels). Useful for finding the exact id/name to pass to gmail_search ("label:Foo") or gmail_modify_labels.',
  parameters: {
    type: 'object',
    properties: {
      accountId: { type: 'number', description: 'Optional account id' },
      email: { type: 'string', description: 'Optional account email' },
    },
  },
  category: 'Gmail',
  toolset: 'gmail',
  handler: async (args) => {
    const acct = await resolveAccount(args);
    if ('error' in acct) return { success: false, error: acct.error };
    if (acct.status === 'auth_expired') {
      return {
        success: false,
        error: `Account ${acct.email} needs re-authentication at /admin/connections/gmail.`,
      };
    }

    try {
      const oauth = await gmailService.getAuthenticatedClient(acct);
      const gmail = gmailService.gmailClientFor(oauth);
      const res = await gmail.users.labels.list({ userId: 'me' });
      const labels = (res.data.labels ?? [])
        .map((l) => ({
          id: l.id ?? '',
          name: l.name ?? '',
          type: (l.type ?? 'user') as string,
          modifiable:
            l.type !== 'system' ||
            (!IMMUTABLE_SYSTEM_LABELS.has(l.id ?? '') && !(l.id ?? '').startsWith('CATEGORY_')),
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'system' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { success: true, data: { account: acct.email, labels } };
    } catch (err) {
      if (isAuthExpiredError(err)) {
        return {
          success: false,
          error: `Account ${acct.email} auth expired. Reconnect at /admin/connections/gmail.`,
        };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

register({
  name: 'gmail_send',
  destructive: true,
  description:
    'Send a new Gmail message from a connected account. Destructive — orchestrator will prompt the user for confirmation before this runs.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient address(es), comma-separated' },
      subject: { type: 'string', description: 'Subject line' },
      bodyText: { type: 'string', description: 'Plain-text body' },
      bodyHtml: { type: 'string', description: 'Optional HTML body' },
      cc: { type: 'string', description: 'Optional CC recipients' },
      bcc: { type: 'string', description: 'Optional BCC recipients' },
      accountId: { type: 'number', description: 'Optional sending account id' },
      email: { type: 'string', description: 'Optional sending account email' },
    },
    required: ['to', 'subject'],
  },
  category: 'Gmail',
  toolset: 'gmail',
  handler: async (args) => {
    const acct = await resolveAccount(args);
    if ('error' in acct) return { success: false, error: acct.error };
    if (acct.status === 'auth_expired') {
      return {
        success: false,
        error: `Account ${acct.email} needs re-authentication at /admin/connections/gmail.`,
      };
    }

    const to = String(args.to ?? '').trim();
    const subject = String(args.subject ?? '').trim();
    if (!to) return { success: false, error: 'to is required' };
    if (!subject) return { success: false, error: 'subject is required' };
    const bodyText = typeof args.bodyText === 'string' ? args.bodyText : undefined;
    const bodyHtml = typeof args.bodyHtml === 'string' ? args.bodyHtml : undefined;
    if (!bodyText && !bodyHtml) {
      return { success: false, error: 'bodyText or bodyHtml is required' };
    }

    try {
      const result = await gmailService.sendMessage(acct, {
        to,
        subject,
        bodyText,
        bodyHtml,
        cc: typeof args.cc === 'string' ? args.cc : undefined,
        bcc: typeof args.bcc === 'string' ? args.bcc : undefined,
      });
      return { success: true, data: { account: acct.email, ...result } };
    } catch (err) {
      if (isAuthExpiredError(err)) {
        return {
          success: false,
          error: `Account ${acct.email} auth expired. Reconnect at /admin/connections/gmail.`,
        };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

register({
  name: 'gmail_reply',
  destructive: true,
  description:
    'Reply on an existing Gmail thread. Threads via In-Reply-To/References + threadId so the reply appears in the same conversation. Destructive — orchestrator will prompt before sending.',
  parameters: {
    type: 'object',
    properties: {
      threadId: { type: 'string', description: 'Gmail thread id to reply on' },
      to: { type: 'string', description: 'Recipient(s) — usually the original sender' },
      subject: { type: 'string', description: 'Reply subject (typically "Re: <original>")' },
      bodyText: { type: 'string', description: 'Plain-text body' },
      bodyHtml: { type: 'string', description: 'Optional HTML body' },
      inReplyTo: {
        type: 'string',
        description: 'RFC822 Message-ID of the message being replied to (gets In-Reply-To header)',
      },
      references: { type: 'string', description: 'References header chain (space-separated)' },
      accountId: { type: 'number', description: 'Optional account id' },
      email: { type: 'string', description: 'Optional account email' },
    },
    required: ['threadId', 'to', 'subject'],
  },
  category: 'Gmail',
  toolset: 'gmail',
  handler: async (args) => {
    const acct = await resolveAccount(args);
    if ('error' in acct) return { success: false, error: acct.error };
    if (acct.status === 'auth_expired') {
      return {
        success: false,
        error: `Account ${acct.email} needs re-authentication at /admin/connections/gmail.`,
      };
    }

    const threadId = String(args.threadId ?? '').trim();
    const to = String(args.to ?? '').trim();
    const subject = String(args.subject ?? '').trim();
    if (!threadId) return { success: false, error: 'threadId is required' };
    if (!to) return { success: false, error: 'to is required' };
    if (!subject) return { success: false, error: 'subject is required' };
    const bodyText = typeof args.bodyText === 'string' ? args.bodyText : undefined;
    const bodyHtml = typeof args.bodyHtml === 'string' ? args.bodyHtml : undefined;
    if (!bodyText && !bodyHtml) {
      return { success: false, error: 'bodyText or bodyHtml is required' };
    }

    try {
      const result = await gmailService.sendMessage(acct, {
        to,
        subject,
        bodyText,
        bodyHtml,
        threadId,
        inReplyTo: typeof args.inReplyTo === 'string' ? args.inReplyTo : undefined,
        references: typeof args.references === 'string' ? args.references : undefined,
      });
      return { success: true, data: { account: acct.email, ...result } };
    } catch (err) {
      if (isAuthExpiredError(err)) {
        return {
          success: false,
          error: `Account ${acct.email} auth expired. Reconnect at /admin/connections/gmail.`,
        };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

register({
  name: 'gmail_modify_labels',
  description:
    'Add and/or remove labels on a Gmail message. Use label ids from gmail_list_labels (e.g. "INBOX", "UNREAD", "STARRED", or a user label id). Cannot modify SENT/DRAFT/CHAT/CATEGORY_*.',
  parameters: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'Gmail message id' },
      add: { type: 'array', items: { type: 'string' }, description: 'Label ids to add' },
      remove: { type: 'array', items: { type: 'string' }, description: 'Label ids to remove' },
      accountId: { type: 'number', description: 'Optional account id' },
      email: { type: 'string', description: 'Optional account email' },
    },
    required: ['messageId'],
  },
  category: 'Gmail',
  toolset: 'gmail',
  handler: async (args) => {
    const acct = await resolveAccount(args);
    if ('error' in acct) return { success: false, error: acct.error };
    if (acct.status === 'auth_expired') {
      return {
        success: false,
        error: `Account ${acct.email} needs re-authentication at /admin/connections/gmail.`,
      };
    }

    const messageId = String(args.messageId ?? '').trim();
    if (!messageId) return { success: false, error: 'messageId is required' };
    const add = Array.isArray(args.add) ? (args.add as unknown[]).map(String) : [];
    const remove = Array.isArray(args.remove) ? (args.remove as unknown[]).map(String) : [];
    if (add.length === 0 && remove.length === 0) {
      return { success: false, error: 'At least one of add/remove must be non-empty' };
    }

    try {
      await gmailService.modifyLabels(acct, messageId, add, remove);
      return { success: true, data: { account: acct.email, messageId, add, remove } };
    } catch (err) {
      if (isAuthExpiredError(err)) {
        return {
          success: false,
          error: `Account ${acct.email} auth expired. Reconnect at /admin/connections/gmail.`,
        };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
