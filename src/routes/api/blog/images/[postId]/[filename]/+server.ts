import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { BLOG_IMAGE_ROOT } from '$lib/blog/upload-paths';

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

export const GET: RequestHandler = async ({ params }) => {
  const { postId, filename } = params;
  if (!postId || !filename) throw error(404, 'not found');

  const abs = normalize(join(BLOG_IMAGE_ROOT, postId, filename));
  const root = normalize(BLOG_IMAGE_ROOT);
  if (!abs.startsWith(root + sep)) throw error(404, 'not found');

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mime = EXT_MIME[ext];
  if (!mime) throw error(404, 'not found');

  let buf: Buffer;
  let size: number;
  try {
    [buf, { size }] = await Promise.all([readFile(abs), stat(abs)]);
  } catch {
    throw error(404, 'not found');
  }

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
