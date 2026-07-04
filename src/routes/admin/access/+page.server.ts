import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { getOwnerEmails } from '$lib/server/access';

export const load: PageServerLoad = async () => {
  const guests = await db
    .select({
      email: allowedUser.email,
      note: allowedUser.note,
      addedBy: allowedUser.addedBy,
      createdAt: allowedUser.createdAt,
    })
    .from(allowedUser)
    .orderBy(desc(allowedUser.createdAt));

  return { owners: getOwnerEmails(), guests };
};
