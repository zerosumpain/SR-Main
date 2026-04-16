import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { unregister } from '$lib/workflows/site-tools/registry-internal';

export const DELETE: RequestHandler = async ({ params }) => {
  const name = params.name;

  const [row] = await db.select().from(customTools).where(eq(customTools.name, name)).limit(1);
  if (!row) {
    return json({ error: `Custom tool "${name}" not found` }, { status: 404 });
  }

  await db.delete(customTools).where(eq(customTools.name, name));
  const removedFromRegistry = unregister(name);

  return json({ success: true, removedFromRegistry });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const name = params.name;
  const body = await request.json().catch(() => ({}));

  const [row] = await db.select().from(customTools).where(eq(customTools.name, name)).limit(1);
  if (!row) {
    return json({ error: `Custom tool "${name}" not found` }, { status: 404 });
  }

  if (typeof body.enabled !== 'boolean') {
    return json({ error: 'Only the `enabled` field can be patched' }, { status: 400 });
  }

  await db
    .update(customTools)
    .set({ enabled: body.enabled })
    .where(eq(customTools.name, name));

  // If disabling, unregister from memory so it stops being callable this session
  if (!body.enabled) {
    unregister(name);
  }
  // NOTE: re-enabling requires a process restart for the in-memory registry
  // to pick the handler back up. Acceptable for now.

  return json({ success: true });
};
