import type { RequestHandler } from './$types';
import { getPublishedDir } from '$lib/jkai/sandbox';
import { db } from '$lib/db';
import { projectVisibility, jkaiBuilds } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { isProjectPublic } from '$lib/projects/visibility';
import { resolveShareToken } from '$lib/projects/guard';
import { isOwnerEmail } from '$lib/server/access';
import { open, realpath, type FileHandle } from 'fs/promises';
import { join, extname, resolve, sep } from 'path';
import { safeGeneratedResponseHeaders } from '$lib/server/generated-content';

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

async function tryFile(filePath: string): Promise<{ handle: FileHandle; mime: string; path: string } | null> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(filePath, 'r');
    const s = await handle.stat();
    if (s.isFile()) {
      return { handle, mime: getMimeType(filePath), path: filePath };
    }
  } catch {}
  await handle?.close().catch(() => {});
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

  const publishedRoot = resolve(getPublishedDir());
  const baseDir = resolve(publishedRoot, params.slug);
  if (baseDir !== publishedRoot && !baseDir.startsWith(publishedRoot + sep)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Lexical containment first, then realpath containment below to prevent an
  // in-tree symlink escaping into deployment files or secrets.
  const resolved = resolve(baseDir, requestedPath);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + sep)) {
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

  let data: ArrayBuffer;
  try {
    const [realPublishedRoot, realBase, realFile] = await Promise.all([
      realpath(publishedRoot),
      realpath(baseDir),
      // Resolve the already-open descriptor, not the path. A generated build
      // cannot swap a checked symlink before the bytes are read.
      realpath(`/proc/self/fd/${result.handle.fd}`),
    ]);
    if (
      (realBase !== realPublishedRoot && !realBase.startsWith(realPublishedRoot + sep)) ||
      (realFile !== realBase && !realFile.startsWith(realBase + sep))
    ) {
      return new Response('Forbidden', { status: 403 });
    }
    const buf = await result.handle.readFile();
    data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return new Response('Not found', { status: 404 });
  } finally {
    await result.handle.close().catch(() => {});
  }

  let responseFile = { data, mime: result.mime, path: result.path };

  // Studio builds only: inject the same <base href> the preview proxy injects,
  // so the two surfaces resolve URLs identically.
  //
  // The preview at /api/jkai/proxy/<id>/ sets <base href> to that prefix, which
  // re-roots EVERY relative URL. Published pages had no base, so the same markup
  // resolved differently on each surface and no single link style worked on
  // both: "../chapter-1/" works published and 404s under the proxy (it climbs
  // above the app root), while "chapter-1/" works under the proxy and 404s
  // published. Observed 2026-08-10 on build 7c5f2ef2 — broken nav, unstyled
  // pages and dead three.js, all from that one mismatch.
  //
  // Gated on studio origin on purpose. The relocated bundles under /projects/
  // (whitehall, brass-and-rails) use "./assets/..." from pages at varying
  // depths; a base tag would re-root those too and break them.
  if (responseFile.mime.startsWith('text/html')) {
    const [studio] = await db
      .select({ id: jkaiBuilds.id })
      .from(jkaiBuilds)
      .where(and(eq(jkaiBuilds.publishedSlug, params.slug), eq(jkaiBuilds.origin, 'studio')))
      .limit(1);
    if (studio) {
      const text = new TextDecoder().decode(responseFile.data);
      if (!/<base\s/i.test(text)) {
        const baseTag = `<base href="/projects/${params.slug}/">`;
        const headMatch = text.match(/<head[^>]*>/i);
        const injected = headMatch
          ? text.replace(headMatch[0], `${headMatch[0]}${baseTag}`)
          : `${baseTag}${text}`;
        responseFile = {
          data: new TextEncoder().encode(injected).buffer as ArrayBuffer,
          mime: responseFile.mime,
          path: responseFile.path,
        };
      }
    }
  }

  const headers = safeGeneratedResponseHeaders(new Headers({ 'Content-Type': responseFile.mime }));
  if (isPublic) {
    if (!responseFile.mime.startsWith('text/html')) headers.set('Cache-Control', 'public, max-age=3600');
  } else {
    // Authed preview of a private project — never cache or index it.
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Robots-Tag', 'noindex');
  }
  return new Response(responseFile.data, { headers });
};
