import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { disableMemberGmail, isAllowedRole, setMemberRole } from '$lib/server/members';

// Owner-only (enforced in hooks.server.ts for /api/admin/access; on the homeserv
// LAN the hook bypasses auth entirely, so this handler adds no session re-check —
// same pattern as the other /api/admin endpoints).

// Deliberately loose email shape check — Google is the real validator at sign-in.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function listGuests() {
  return db
    .select({
      email: allowedUser.email,
      note: allowedUser.note,
      addedBy: allowedUser.addedBy,
      role: allowedUser.role,
      createdAt: allowedUser.createdAt,
    })
    .from(allowedUser)
    .orderBy(desc(allowedUser.createdAt));
}

/** GET — the owner list (read-only, from env) plus the editable guest list. */
export const GET: RequestHandler = async () => {
  const [owners, guests] = await Promise.all([
    Promise.resolve(getOwnerEmails()),
    listGuests(),
  ]);
  return json({ owners, guests });
};

/** POST { email, note? } — add a guest to the login allow-list. */
export const POST: RequestHandler = async ({ request, locals }) => {
  let body: { email?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  if (!EMAIL_RE.test(email)) {
    return json({ error: 'Enter a valid email address' }, { status: 400 });
  }
  if (isOwnerEmail(email)) {
    return json({ error: 'That address is already a site owner' }, { status: 400 });
  }

  const session = await locals.auth();
  const addedBy = (session?.user?.email || '').toLowerCase() || null;

  if (note !== null) {
    // A note was supplied — upsert it (re-adding an existing guest refreshes it).
    await db
      .insert(allowedUser)
      .values({ email, note, addedBy })
      .onConflictDoUpdate({ target: allowedUser.email, set: { note } });
  } else {
    // No note supplied — insert if new, but never wipe an existing guest's note
    // (or addedBy/createdAt) when the owner re-adds them with the field blank.
    await db
      .insert(allowedUser)
      .values({ email, note: null, addedBy })
      .onConflictDoNothing();
  }

  return json({ ok: true, guests: await listGuests() });
};

/**
 * PATCH { email, role } — make a guest a member ('member') or take it back
 * ('guest'). Promotion creates their intel space; demotion leaves it in place
 * and stops their Gmail being swept. See $lib/server/members.
 */
export const PATCH: RequestHandler = async ({ request }) => {
  let body: { email?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  if (!email) return json({ error: 'Missing email' }, { status: 400 });
  if (!isAllowedRole(body.role)) return json({ error: "role must be 'guest' or 'member'" }, { status: 400 });
  if (!(await setMemberRole(email, body.role))) return json({ error: 'Not on the allow-list' }, { status: 404 });
  return json({ ok: true, guests: await listGuests() });
};

/** DELETE { email } — revoke a guest's sign-in access. */
export const DELETE: RequestHandler = async ({ request }) => {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  if (!email) return json({ error: 'Missing email' }, { status: 400 });

  // A member losing sign-in loses their mail sweep too; their graph stays.
  await disableMemberGmail(email);
  await db.delete(allowedUser).where(eq(allowedUser.email, email));
  return json({ ok: true, guests: await listGuests() });
};
