import { familyLevel } from '$lib/access/roles';
import { isOwnerEmail } from '$lib/server/access';
import { loadMember } from '$lib/server/grants';

const norm = (e: string) => e.trim().toLowerCase();

/** Owner, parent, circle, or null for someone outside the family. Fails closed. */
export async function familyRole(email: string): Promise<{ parent: boolean } | null> {
  const e = norm(email);
  if (!e) return null;
  if (isOwnerEmail(e)) return { parent: true };
  const member = await loadMember(e).catch(() => null);
  if (!member) return null;
  const level = familyLevel(member.grants);
  return level === 'none' ? null : { parent: level === 'parent' };
}
