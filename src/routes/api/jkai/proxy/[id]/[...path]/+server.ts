import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { proxyToSandbox } from '$lib/jkai/serve';
import { authorize } from '../../../auth';

const handler: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url)) return new Response('Unauthorized', { status: 401 });
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build?.serveConfig) return new Response('Project not serving', { status: 404 });
  const config = build.serveConfig as { port: number };
  const path = '/' + (params.path || '');
  return proxyToSandbox(config.port, path, request);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
