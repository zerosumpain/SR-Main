// The one write path onto the guest allow-list, shared by the add form at
// /admin/access, an accepted invite ($lib/server/invites) and an approved
// request ($lib/server/access-requests).
//
// Not in ./access: that file is duplicated byte-for-byte into SR-Health and
// SR-Drive (shared-with-extracted.json), and neither of them writes the list.

import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';

/**
 * Put a person on the allow-list. A supplied note is upserted (re-adding
 * someone refreshes it); with no note an existing person is left exactly as
 * they were — their note, `addedBy` and `createdAt` are never wiped by a
 * re-add with the field blank. They start with no permissions; groups are
 * applied separately (`setUserAccess` / `joinGroups`).
 */
export async function addToAllowList(input: {
  email: string;
  note?: string | null;
  addedBy?: string | null;
}): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const note = input.note?.trim() ? input.note.trim() : null;
  const addedBy = input.addedBy?.trim().toLowerCase() || null;
  if (note !== null) {
    await db
      .insert(allowedUser)
      .values({ email, note, addedBy })
      .onConflictDoUpdate({ target: allowedUser.email, set: { note } });
  } else {
    await db.insert(allowedUser).values({ email, note: null, addedBy }).onConflictDoNothing();
  }
}
