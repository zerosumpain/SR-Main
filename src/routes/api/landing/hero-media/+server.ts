import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { preparedHeroBytes } from '$lib/server/hero-sources';
import { mediaRange } from '$lib/server/hero-source-policy';

export const GET: RequestHandler = async ({ request, url }) => {
  const id = url.searchParams.get('id') ?? '';
  const variant = url.searchParams.get('variant');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
      !['desktop', 'mobile', 'poster'].includes(variant ?? '')) error(404, 'Media not found');
  const kind = variant as 'desktop' | 'mobile' | 'poster';
  const bytes = await preparedHeroBytes(id, kind).catch(() => null);
  if (!bytes) error(404, 'Media not found');
  const rangeHeader = request.headers.get('range');
  const range = mediaRange(rangeHeader, bytes.length);
  if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${bytes.length}` } });
  const headers: Record<string, string> = {
    'content-type': kind === 'poster' ? 'image/webp' : 'video/mp4',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox',
    'accept-ranges': 'bytes', 'content-length': String(range.end - range.start + 1),
  };
  if (rangeHeader) headers['content-range'] = `bytes ${range.start}-${range.end}/${bytes.length}`;
  return new Response(new Uint8Array(bytes.subarray(range.start, range.end + 1)), { status: rangeHeader ? 206 : 200, headers });
};
