import { json, error } from '@sveltejs/kit';
import { assessContext, developmentContext } from '$lib/codegraph/development.server';
import { snapshotCandidate, workspaceBroker } from '$lib/jkai/development-workspace.server';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params, url }) => {
  const context = await developmentContext(params.id);
  const file = url.searchParams.get('file');
  if (file) {
    if (!context.snapshot || context.snapshot.scope !== 'candidate') throw error(409, 'A saved candidate snapshot is required to open source.');
    return json(await workspaceBroker('code-source', params.id, { revision: context.snapshot.revision, file }));
  }
  return json(context);
};
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  if (body.action === 'refresh') {
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
    if (!build || ['running', 'queued'].includes(build.status)) throw error(409, 'Pause the build before refreshing its structural snapshot.');
    await snapshotCandidate(params.id);
  } else {
    try { await assessContext(params.id, body.targetId, body.verdict, body.evidence, body.revision ?? null); }
    catch (e) { throw error(400, e instanceof Error ? e.message : 'Invalid context assessment'); }
  }
  return json(await developmentContext(params.id));
};
