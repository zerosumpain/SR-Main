// Owner-only deck share-link management (hook-gated like /api/projects/share,
// which this mirrors). POST mints a link (raw token returned ONCE), GET lists,
// DELETE revokes.

import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { decks } from '$lib/db/schema';
import { createShare, listShares, revokeShare } from '$lib/decks/shares';
import type { RequestHandler } from './$types';

async function ownerEmail(locals: App.Locals): Promise<string> {
  try {
    const s = await locals.auth();
    return s?.user?.email ?? 'owner';
  } catch {
    return 'owner';
  }
}

async function deckExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: decks.id }).from(decks).where(eq(decks.id, id));
  return Boolean(row);
}

export const GET: RequestHandler = async ({ params }) => {
  if (!(await deckExists(params.id))) return json({ error: 'Unknown deck' }, { status: 404 });
  return json({ ok: true, shares: await listShares(params.id) });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!(await deckExists(params.id))) return json({ error: 'Unknown deck' }, { status: 404 });
  let body: { label?: unknown; expiresInDays?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }

  const active = (await listShares(params.id)).filter(
    (s) => !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt).getTime() > Date.now()),
  );
  if (active.length >= 50) {
    return json({ error: 'Too many active links for this deck (max 50) — revoke some first.' }, { status: 400 });
  }

  let expiresAt: Date | null = null;
  if (typeof body.expiresInDays === 'number' && Number.isFinite(body.expiresInDays) && body.expiresInDays > 0) {
    expiresAt = new Date(Date.now() + Math.min(body.expiresInDays, 3650) * 24 * 60 * 60 * 1000);
  }

  const { id, token } = await createShare({
    deckId: params.id,
    createdBy: await ownerEmail(locals),
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null,
    expiresAt,
  });
  return json({ ok: true, id, token });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  let body: { shareId?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.shareId !== 'string' || !body.shareId) return json({ error: 'shareId required' }, { status: 400 });
  const ok = await revokeShare(body.shareId, params.id);
  return ok ? json({ ok: true }) : json({ error: 'Unknown share' }, { status: 404 });
};
