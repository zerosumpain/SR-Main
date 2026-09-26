import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isOwnerEmail } from '$lib/server/access';
import { addToAllowList } from '$lib/server/allow-list';
import { disableMemberGmail } from '$lib/server/members';
import { setUserAccess } from '$lib/server/grants';
import { loadAccessPage } from '$lib/server/access-page';

// Owner-only (enforced in hooks.server.ts for /api/admin/access; on the homeserv
// LAN the hook bypasses auth entirely, so this handler adds no session re-check —
// same pattern as the other /api/admin endpoints).

// Deliberately loose email shape check — Google is the real validator at sign-in.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function emailOf(b: Record<string, unknown>): string {
  return (typeof b.email === 'string' ? b.email : '').trim().toLowerCase();
}

/** GET — Super Admin (read-only, from env), the people on the allow-list with their access, and the groups. */
export const GET: RequestHandler = async () => json(await loadAccessPage());

/** POST { email, note? } — add a person to the login allow-list. They start with no access. */
export const POST: RequestHandler = async ({ request, locals }) => {
  const b = await body(request);
  if (!b) return json({ error: 'Invalid JSON' }, { status: 400 });

  const email = emailOf(b);
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;

  if (!EMAIL_RE.test(email)) {
    return json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  if (isOwnerEmail(email)) {
    return json({ error: 'That address is already the Super Admin' }, { status: 400 });
  }

  const session = await locals.auth();
  const addedBy = (session?.user?.email || '').toLowerCase() || null;

  // Upserts a supplied note; never wipes an existing person's note, addedBy or
  // createdAt when they are re-added with the field blank.
  await addToAllowList({ email, note, addedBy });

  return json({ ok: true, ...(await loadAccessPage()) });
};

/**
 * PATCH { email, groups, grants } — set what a person may do: the groups they
 * are in and any one-off permissions on top. Unknown groups and permissions are
 * dropped (see $lib/server/grants). Holding anything creates their principal;
 * holding no intel level stops their Gmail being swept.
 */
export const PATCH: RequestHandler = async ({ request }) => {
  const b = await body(request);
  if (!b) return json({ error: 'Invalid JSON' }, { status: 400 });
  const email = emailOf(b);
  if (!email) return json({ error: 'Missing email' }, { status: 400 });
  if (!Array.isArray(b.groups) || !Array.isArray(b.grants)) {
    return json({ error: 'groups and grants must be lists' }, { status: 400 });
  }
  const saved = await setUserAccess(email, { groups: b.groups, grants: b.grants });
  if (!saved) return json({ error: 'Not on the allow-list' }, { status: 404 });
  return json({ ok: true, saved, ...(await loadAccessPage()) });
};

/** DELETE { email } — revoke a person's sign-in access. */
export const DELETE: RequestHandler = async ({ request }) => {
  const b = await body(request);
  if (!b) return json({ error: 'Invalid JSON' }, { status: 400 });
  const email = emailOf(b);
  if (!email) return json({ error: 'Missing email' }, { status: 400 });

  // Losing sign-in loses the mail sweep too; their material stays.
  await disableMemberGmail(email);
  await db.delete(allowedUser).where(eq(allowedUser.email, email));
  return json({ ok: true, ...(await loadAccessPage()) });
};
