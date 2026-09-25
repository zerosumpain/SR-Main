import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { gmailAccounts, gmailWatches } from '$lib/db/schema';
import { ownerGmailWhere } from '$lib/workflows/gmail/owner-accounts';

export const load: PageServerLoad = async () => {
  // The owner's mailboxes. A member's has no Test / Watch / Delete here: it is
  // theirs, connected read-only, and managed by demoting them at /admin/access.
  const rows = await db.select().from(gmailAccounts).where(ownerGmailWhere());
  const ownIds = new Set(rows.map((a) => a.id));
  const watches = (await db.select().from(gmailWatches)).filter((w) => ownIds.has(w.accountId));
  return {
    accounts: rows.map((a) => ({
      id: a.id,
      email: a.email,
      status: a.status,
      scopes: a.scopes,
      lastError: a.lastError,
      createdAt: a.createdAt,
    })),
    watches,
  };
};
