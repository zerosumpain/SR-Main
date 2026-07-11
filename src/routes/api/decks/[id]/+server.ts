// Owner-only deck meta management. Auth is enforced by the hook (401 for
// /api/* when unauthed) exactly like /api/projects/share — handlers validate
// the resource, not the session. PATCH edits meta / publishes; DELETE removes
// the deck (slides + shares cascade).

import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { decks } from '$lib/db/schema';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
  let body: { title?: unknown; description?: unknown; isPublic?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const [deck] = await db.select({ id: decks.id }).from(decks).where(eq(decks.id, params.id));
  if (!deck) return json({ error: 'Unknown deck' }, { status: 404 });

  const patch: Partial<{ title: string; description: string | null; isPublic: boolean; updatedAt: Date }> = {
    updatedAt: new Date(),
  };
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 160);
  if (typeof body.description === 'string') patch.description = body.description.trim() || null;
  if (typeof body.isPublic === 'boolean') patch.isPublic = body.isPublic;

  await db.update(decks).set(patch).where(eq(decks.id, params.id));
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const rows = await db.delete(decks).where(eq(decks.id, params.id)).returning({ id: decks.id });
  if (rows.length === 0) return json({ error: 'Unknown deck' }, { status: 404 });
  return json({ ok: true });
};
