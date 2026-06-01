import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { Cron } from 'croner';
import { db } from '$lib/db';
import { forgeSchedules } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// Owner allowlist — mirrors getAllowedEmails() in src/hooks.server.ts and
// /api/auth/me (the AUTH_ALLOWED_EMAILS env var, comma-separated, lower-cased).
function allowedEmails(): string[] {
  return (env.AUTH_ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isOwner(locals: App.Locals): Promise<boolean> {
  return locals.auth().then((session) => {
    const email = (session?.user?.email || '').toLowerCase();
    return !!email && allowedEmails().includes(email);
  });
}

/**
 * PATCH /api/jkai/forge/schedules/[id] — owner-gated. Update fields.
 * Body: { enabled?: boolean, cron?: string, directive?: string }
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  if (!(await isOwner(locals))) return json({ error: 'forbidden' }, { status: 403 });

  let body: { enabled?: unknown; cron?: unknown; directive?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const updates: Partial<typeof forgeSchedules.$inferInsert> = {};

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return json({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    updates.enabled = body.enabled;
  }
  if ('cron' in body) {
    if (typeof body.cron !== 'string' || !body.cron.trim()) {
      return json({ error: 'cron must be a non-empty string' }, { status: 400 });
    }
    try {
      new Cron(body.cron, { paused: true }).stop();
    } catch (err) {
      return json(
        { error: `invalid cron expression: ${err instanceof Error ? err.message : String(err)}` },
        { status: 400 },
      );
    }
    updates.cron = body.cron;
  }
  if ('directive' in body) {
    if (typeof body.directive !== 'string' || !body.directive.trim()) {
      return json({ error: 'directive must be a non-empty string' }, { status: 400 });
    }
    updates.directive = body.directive;
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: 'no updatable fields provided' }, { status: 400 });
  }

  const [row] = await db
    .update(forgeSchedules)
    .set(updates)
    .where(eq(forgeSchedules.id, params.id))
    .returning();

  if (!row) return json({ error: 'not found' }, { status: 404 });
  return json({ schedule: row });
};

/** DELETE /api/jkai/forge/schedules/[id] — owner-gated. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!(await isOwner(locals))) return json({ error: 'forbidden' }, { status: 403 });

  const [row] = await db
    .delete(forgeSchedules)
    .where(eq(forgeSchedules.id, params.id))
    .returning();

  if (!row) return json({ error: 'not found' }, { status: 404 });
  return json({ ok: true });
};
