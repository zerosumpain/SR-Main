import type { RequestHandler } from './$types';
import { getPublishedDir } from '$lib/jkai/sandbox';
import { db } from '$lib/db';
import { projectVisibility } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isProjectPublic } from '$lib/projects/visibility';
import { resolveShareToken } from '$lib/projects/guard';
import { isOwnerEmail } from '$lib/server/access';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';

// Relocated static bundles (whitehall, brass-and-rails) use relative ./assets/
// paths across multiple HTML files, so the trailing slash must be preserved —
// never let SvelteKit strip it (default is 'never').
export const trailingSlash = 'ignore';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

function getMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function tryFile(filePath: string): Promise<{ data: ArrayBuffer; mime: string } | null> {
  try {
    const s = await stat(filePath);
    if (s.isFile()) {
      const buf = await readFile(filePath);
      return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), mime: getMimeType(filePath) };
    }
  } catch {}
  return null;
}

export const GET: RequestHandler = async ({ params, url, locals, cookies }) => {
  const requestedPath = params.path || '';

  // Visibility gate: a private project (and all its assets) 404s for the public.
  // The signed-in owner can preview it; a valid share token (?t= or the project
  // cookie) also grants access to a private project without signing in.
  const [vis] = await db
    .select({ projectKey: projectVisibility.projectKey, isPublic: projectVisibility.isPublic })
    .from(projectVisibility)
    .where(eq(projectVisibility.projectKey, params.slug));
  const visMap = vis ? { [vis.projectKey]: vis.isPublic } : {};
  const isPublic = isProjectPublic(visMap, params.slug);
  if (!isPublic) {
    const session = await locals.auth();
    const owner = isOwnerEmail(session?.user?.email);
    if (!owner && !(await resolveShareToken(params.slug, { locals, url, cookies }))) {
      return new Response('Not found', { status: 404 });
    }
  }

  // Directory root without a trailing slash breaks the bundles' relative asset
  // paths — redirect /projects/<slug> -> /projects/<slug>/ before serving. The
  // share token has already been exchanged for the psh_ cookie above, so drop it
  // from the Location (keeps the live token out of history/logs); a private
  // project's redirect must also stay uncacheable and unindexed.
  if (!requestedPath && !url.pathname.endsWith('/')) {
    const qs = new URLSearchParams(url.search);
    qs.delete('t');
    const search = qs.toString();
    const headers: Record<string, string> = { Location: url.pathname + '/' + (search ? '?' + search : '') };
    if (!isPublic) {
      headers['Cache-Control'] = 'private, no-store';
      headers['X-Robots-Tag'] = 'noindex';
    }
    return new Response(null, { status: 308, headers });
  }

  const baseDir = join(getPublishedDir(), params.slug);

  // Security: prevent path traversal
  const resolved = join(baseDir, requestedPath);
  if (!resolved.startsWith(baseDir)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Try exact file
  let result = await tryFile(resolved);

  // Try index.html in directory
  if (!result) {
    result = await tryFile(join(resolved, 'index.html'));
  }

  // SPA fallback: serve root index.html for paths without extensions
  if (!result && !extname(requestedPath)) {
    result = await tryFile(join(baseDir, 'index.html'));
  }

  if (!result) {
    return new Response('Not found', { status: 404 });
  }

  const headers: Record<string, string> = { 'Content-Type': result.mime };
  if (isPublic) {
    headers['Cache-Control'] = 'public, max-age=3600';
  } else {
    // Authed preview of a private project — never cache or index it.
    headers['Cache-Control'] = 'private, no-store';
    headers['X-Robots-Tag'] = 'noindex';
  }
  return new Response(result.data, { headers });
};
