import { json, error } from '@sveltejs/kit';
import {
  listSnapshots,
  activateSnapshot,
  snapshotNow,
  resetWorkspace,
} from '$lib/jkai/sandbox';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const snapshots = await listSnapshots(params.id!);
  return json({ snapshots });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const buildId = params.id!;
  const body = (await request.json().catch(() => null)) as
    | { action?: string; iterationNumber?: number }
    | null;
  if (!body || typeof body.action !== 'string') throw error(400, 'action required');

  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) throw error(404, 'build not found');
  if (build.status === 'running') {
    throw error(409, 'pause the build before sandbox actions');
  }

  if (body.action === 'reset') {
    await resetWorkspace(buildId);
    return json({ ok: true });
  }
  if (body.action === 'snapshot') {
    const n = await snapshotNow(buildId);
    return json({ ok: true, snapshot: n });
  }
  if (body.action === 'restore') {
    if (typeof body.iterationNumber !== 'number') {
      throw error(400, 'iterationNumber required');
    }
    const serve = (build.serveConfig as { startCommand?: string; port?: number; healthCheck?: string } | null) ?? {};
    const ok = await activateSnapshot(
      buildId,
      body.iterationNumber,
      serve.startCommand ?? '',
      serve.port ?? 0,
      serve.healthCheck ?? '/',
    );
    return json({ ok });
  }
  throw error(400, `unknown action: ${body.action}`);
};
