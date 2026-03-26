import type { RequestHandler } from './$types';
import { getPublishedDir } from '$lib/jkai/sandbox';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';

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

export const GET: RequestHandler = async ({ params }) => {
  const baseDir = join(getPublishedDir(), params.slug);
  const requestedPath = params.path || '';

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

  return new Response(result.data, {
    headers: {
      'Content-Type': result.mime,
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
