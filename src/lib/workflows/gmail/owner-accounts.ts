// Which Gmail accounts the owner's machinery may touch: the owner's, only.
//
// A family member's mailbox (`principal_id = 'u_…'`) is read by exactly one
// thing — the nightly intel sweep, into that member's own space. Everything
// else that picks a Gmail account — chat's gmail tools, workflow nodes and
// triggers, the watcher, canvas pickers, the connectors probe, the admin page —
// acts for the owner, and several of them SEND or relabel. They must never
// resolve to a member's account, whether by id, by address, or by the old
// "most recently updated active account" default: a member's token refreshes
// bump `updated_at` like anyone's, so without this filter their mailbox would
// quietly become the default for the owner's chat.
import { and, eq, type SQL } from 'drizzle-orm';
import { gmailAccounts } from '$lib/db/schema';
import { OWNER_SPACE } from '$lib/jkai/intel/scope';

/** `principal_id = 'owner'`, optionally AND-ed with more conditions. */
export function ownerGmailWhere(...more: Array<SQL | undefined>): SQL {
  return and(eq(gmailAccounts.principalId, OWNER_SPACE), ...more)!;
}

export function isOwnerGmailAccount(acct: { principalId: string } | null | undefined): boolean {
  return !!acct && acct.principalId === OWNER_SPACE;
}
