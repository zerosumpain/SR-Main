import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { ownerGmailWhere } from '$lib/integrations/gmail/owner-accounts';

export const load: PageServerLoad = async () => {
  // The owner's mailboxes. A member's has no Test / Delete here: it is theirs,
  // connected read-only, and managed by demoting them at /admin/access.
  const rows = await db.select().from(gmailAccounts).where(ownerGmailWhere());
  return {
    accounts: rows.map((a) => ({
      id: a.id,
      email: a.email,
      status: a.status,
      scopes: a.scopes,
      lastError: a.lastError,
      createdAt: a.createdAt,
    })),
  };
};
