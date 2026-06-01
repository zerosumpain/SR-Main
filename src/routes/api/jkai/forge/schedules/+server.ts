import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { Cron } from 'croner';
import { db } from '$lib/db';
import { forgeSchedules } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

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

const MODES = ['scheduled', 'autonomous'] as const;

/** GET /api/jkai/forge/schedules — owner-gated. List all forge schedules, newest first. */
export const GET: RequestHandler = async ({ locals }) => {
  if (!(await isOwner(locals))) return json({ error: 'forbidden' }, { status: 403 });

  const rows = await db
    .select()
    .from(forgeSchedules)
    .orderBy(desc(forgeSchedules.createdAt));
  return json({ schedules: rows });
};

/**
 * POST /api/jkai/forge/schedules — owner-gated. Create a schedule.
 * Body: { cron: string, directive: string, mode: 'scheduled' | 'autonomous' }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!(await isOwner(locals))) return json({ error: 'forbidden' }, { status: 403 });

  let body: { cron?: unknown; directive?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { cron, directive, mode } = body;

  if (!cron || typeof cron !== 'string') {
    return json({ error: 'cron is required' }, { status: 400 });
  }
  if (typeof directive !== 'string' || !directive.trim()) {
    return json({ error: 'directive is required' }, { status: 400 });
  }
  if (typeof mode !== 'string' || !MODES.includes(mode as (typeof MODES)[number])) {
    return json({ error: `mode must be one of ${MODES.join(', ')}` }, { status: 400 });
  }

  // Validate the cron expression parses (paused so it never fires here).
  try {
    new Cron(cron, { paused: true }).stop();
  } catch (err) {
    return json(
      { error: `invalid cron expression: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  const [row] = await db
    .insert(forgeSchedules)
    .values({ cron, directive, mode })
    .returning();

  return json({ schedule: row }, { status: 201 });
};
