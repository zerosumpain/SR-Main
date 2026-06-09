import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllowedProjectKeys } from '$lib/projects/registry';
import { createShare, listShares, revokeShare } from '$lib/projects/shares';

// Owner-only management of per-project share links. Auth is enforced by the hook
// (401 for /api/* when unauthed; bypassed on the homeserv LAN), exactly like the
// visibility endpoint — the signIn allow-list means any authenticated caller is
// the owner, so this handler does not re-check the session for access. POST
// mints a link (returns the raw token ONCE), GET lists, DELETE revokes.

async function ownerEmail(locals: App.Locals): Promise<string> {
  try {
    const s = await locals.auth();
    return s?.user?.email ?? 'owner';
  } catch {
    return 'owner';
  }
}

async function validKey(key: string): Promise<boolean> {
  if (!key) return false;
  const allowed = await getAllowedProjectKeys();
  return allowed.has(key);
}

export const GET: RequestHandler = async ({ url }) => {
  const key = url.searchParams.get('key') ?? '';
  if (!(await validKey(key))) return json({ error: 'Unknown project key' }, { status: 400 });
  return json({ ok: true, key, shares: await listShares(key) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  let body: { key?: unknown; label?: unknown; expiresInDays?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const key = typeof body.key === 'string' ? body.key : '';
  if (!(await validKey(key))) return json({ error: 'Unknown project key' }, { status: 400 });

  // Bound the active-link set per project (owner-only, cheap defence-in-depth).
  const active = (await listShares(key)).filter(
    (s) => !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt).getTime() > Date.now()),
  );
  if (active.length >= 50) {
    return json({ error: 'Too many active links for this project (max 50) — revoke some first.' }, { status: 400 });
  }

  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null;
  let expiresAt: Date | null = null;
  if (typeof body.expiresInDays === 'number' && Number.isFinite(body.expiresInDays) && body.expiresInDays > 0) {
    expiresAt = new Date(Date.now() + Math.min(body.expiresInDays, 3650) * 24 * 60 * 60 * 1000);
  }

  const { id, token } = await createShare({
    projectKey: key,
    createdBy: await ownerEmail(locals),
    label,
    expiresAt,
  });
  // token returned ONCE — the DB only stores its sha256.
  return json({ ok: true, id, token, key, expiresAt });
};

export const DELETE: RequestHandler = async ({ request }) => {
  let body: { key?: unknown; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const key = typeof body.key === 'string' ? body.key : '';
  const id = typeof body.id === 'string' ? body.id : '';
  if (!key || !id) return json({ error: 'Missing key or id' }, { status: 400 });
  if (!(await validKey(key))) return json({ error: 'Unknown project key' }, { status: 400 });
  const revoked = await revokeShare(id, key);
  return json({ ok: revoked });
};
