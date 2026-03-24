import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { proxyToSandbox } from '$lib/jkai/serve';

const handler: RequestHandler = async ({ params, request }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build?.serveConfig) return new Response('Project not serving', { status: 404 });
  const config = build.serveConfig as { port: number };
  const path = '/' + (params.path || '');
  // Base href ensures all relative URLs in the proxied app resolve through the proxy
  const baseHref = `/api/jkai/proxy/${params.id}/`;
  return proxyToSandbox(config.port, path, request, baseHref);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
