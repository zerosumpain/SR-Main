import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { ticketFromSegment, verifyCastTicket } from '$lib/family/backlog-cast';
import { castFile } from '$lib/family/backlog-cast.server';
import { getItem } from '$lib/family/backlog.server';
import { mediaRange } from '$lib/server/hero-source-policy';

/**
 * GET /cast/<ticket>.mp4 — one fetched backlog video, for a TV.
 *
 * Public because a Chromecast or an AirPlay TV has no login: the ticket is the
 * permission. It is HMAC-signed over one item id, lasts six hours, and the item
 * must still be on the list. Forged, expired, deleted and evicted all 404
 * alike. Ranges are served because a TV seeks by asking for them.
 */
export const GET: RequestHandler = async ({ params, request }) => {
  const id = verifyCastTicket(ticketFromSegment(params.ticket), env.AUTH_SECRET);
  if (!id) error(404, 'Not found');
  const [item, file] = await Promise.all([getItem(id), castFile(id)]);
  if (!item || !file) error(404, 'Not found');

  const rangeHeader = request.headers.get('range');
  const range = mediaRange(rangeHeader, file.size);
  if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } });
  const headers: Record<string, string> = {
    'content-type': 'video/mp4',
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex',
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
    // A Chromecast receiver is a web page on another origin; it fetches the
    // media with CORS.
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
    'content-length': String(range.end - range.start + 1),
  };
  if (rangeHeader) headers['content-range'] = `bytes ${range.start}-${range.end}/${file.size}`;
  const stream = Readable.toWeb(createReadStream(file.path, { start: range.start, end: range.end })) as ReadableStream;
  return new Response(stream, { status: rangeHeader ? 206 : 200, headers });
};
