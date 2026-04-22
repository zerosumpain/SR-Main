import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { gmailAccounts, gmailWatches } from '$lib/db/schema';

export const load: PageServerLoad = async () => {
  const rows = await db.select().from(gmailAccounts);
  const watches = await db.select().from(gmailWatches);
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
