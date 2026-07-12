import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { readBlogImage } from '$lib/blog/image-store';

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  // deck-media video uploads (video blocks) ride the same store; served as a
  // whole body (no range support) which <video> handles fine for short clips.
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export const GET: RequestHandler = async ({ params }) => {
  const { postId, filename } = params;
  if (!postId || !filename) throw error(404, 'not found');

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mime = EXT_MIME[ext];
  if (!mime) throw error(404, 'not found');

  // Traversal is guarded inside readBlogImage → blogImageKey; a bad key or a
  // missing image both surface as a 404 here.
  let buf: Buffer;
  try {
    buf = await readBlogImage(postId, filename);
  } catch {
    throw error(404, 'not found');
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(buf.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
