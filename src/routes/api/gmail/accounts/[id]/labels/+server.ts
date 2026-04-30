import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { gmailService } from '$lib/workflows/gmail/service';

// Gmail system labels which cannot be added or removed via users.messages.modify.
// Gmail API rejects requests that try to mutate these.
//   - SENT / DRAFT / CHAT — managed by Gmail itself
//   - CATEGORY_* — assigned by Gmail's categorization, not user-modifiable
// Other system labels (INBOX, STARRED, UNREAD, IMPORTANT, SPAM, TRASH) ARE
// modifiable and remain in the list.
const IMMUTABLE_SYSTEM_LABELS = new Set(['SENT', 'DRAFT', 'CHAT']);

function isModifiableLabel(label: { id?: string | null; type?: string | null }): boolean {
  const id = label.id ?? '';
  if (!id) return false;
  if (label.type === 'system') {
    if (IMMUTABLE_SYSTEM_LABELS.has(id)) return false;
    if (id.startsWith('CATEGORY_')) return false;
  }
  return true;
}

export const GET: RequestHandler = async ({ params }) => {
  const accountId = Number(params.id);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return json({ error: 'invalid account id' }, { status: 400 });
  }

  const [acct] = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, accountId));
  if (!acct) return json({ error: 'not found' }, { status: 404 });

  if (acct.status === 'auth_expired') {
    return json(
      { error: 'auth_expired', message: 'Account needs to be reconnected at /admin/gmail.' },
      { status: 410 },
    );
  }

  try {
    const oauth = await gmailService.getAuthenticatedClient(acct);
    const gmail = gmailService.gmailClientFor(oauth);
    const res = await gmail.users.labels.list({ userId: 'me' });
    const raw = res.data.labels ?? [];

    const labels = raw
      .filter(isModifiableLabel)
      .map((l) => ({
        id: l.id ?? '',
        name: l.name ?? '',
        type: (l.type ?? 'user') as string,
        messageListVisibility: l.messageListVisibility ?? null,
        labelListVisibility: l.labelListVisibility ?? null,
      }))
      // System labels first (INBOX, STARRED, UNREAD, ...), then user labels
      // alphabetically by name.
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'system' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return json({ labels });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid_grant|auth_expired/i.test(msg)) {
      return json(
        { error: 'auth_expired', message: 'Account needs to be reconnected at /admin/gmail.' },
        { status: 410 },
      );
    }
    return json({ error: 'gmail_api_failed', message: msg }, { status: 502 });
  }
};
