import { json, error } from '@sveltejs/kit';
import { readDevFile, writeDevFile } from '$lib/jkai/sandbox';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const content = await readDevFile(params.id!, params.path ?? '');
    return json({ content });
  } catch (err) {
    return json({ content: '', error: (err as Error).message }, { status: 200 });
  }
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const buildId = params.id!;
  const path = params.path ?? '';
  if (!path) throw error(400, 'path required');
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) throw error(404, 'build not found');
  if (build.status === 'running') {
    throw error(409, 'pause the build before editing files');
  }
  const body = (await request.json().catch(() => null)) as { content?: string } | null;
  if (!body || typeof body.content !== 'string') {
    throw error(400, 'content required');
  }
  await writeDevFile(buildId, path, body.content);
  return json({ ok: true });
};
