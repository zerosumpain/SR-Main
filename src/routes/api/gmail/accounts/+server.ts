import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { driveIntelOutbox, gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ownerGmailWhere } from '$lib/workflows/gmail/owner-accounts';

export const GET: RequestHandler = async () => {
  const rows = await db.select({
    id: gmailAccounts.id,
    email: gmailAccounts.email,
    status: gmailAccounts.status,
    scopes: gmailAccounts.scopes,
    lastError: gmailAccounts.lastError,
    createdAt: gmailAccounts.createdAt,
  }).from(gmailAccounts).where(ownerGmailWhere());
  // The owner's mailboxes only — this feeds every canvas Gmail picker, and a
  // family member's mailbox must never be pickable (see owner-accounts.ts).
  return json(rows);
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = Number(url.searchParams.get('id'));
  if (!id) return json({ error: 'id required' }, { status: 400 });
  // Disconnecting is also the privacy page's promise that what was taken from
  // this mailbox goes with it. Main does not own intel rows, so it hands
  // SR-Jkai-Core a `mail-purge` job on the shared outbox, in the same
  // transaction as the delete: the job exists exactly when the account is gone.
  // Core deletes the mailbox's email notes, their graph facts, its mail
  // search index and its saved attachments, in that account's space.
  await db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(gmailAccounts)
      .where(ownerGmailWhere(eq(gmailAccounts.id, id)))
      .returning({ id: gmailAccounts.id, email: gmailAccounts.email, principalId: gmailAccounts.principalId });
    if (!gone) return;
    await tx.insert(driveIntelOutbox).values({
      kind: 'mail-purge',
      ref: String(gone.id),
      payload: { email: gone.email, spaceId: gone.principalId },
    });
  });
  return json({ ok: true });
};
