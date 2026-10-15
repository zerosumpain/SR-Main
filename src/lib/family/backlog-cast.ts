// Playing a family backlog item on a TV — the pure half: which items can be
// fetched as a video file, the ticket that lets a TV (which has no login)
// fetch that file, the yt-dlp command line, and the shape the phone reads.
// Fetching, the cache and the clock are ./backlog-cast.server.
//
// A Chromecast's Default Media Receiver (and AirPlay) plays a plain MP4 from a
// URL, and nothing else: not a TikTok page, not an Instagram page, not a web
// page. So the server fetches the clip with yt-dlp and hands the phone a
// short-lived link to the file; the phone tells the TV to play that link.
// Anything that cannot be fetched falls back to the phone: open it there and
// mirror the screen (or, for YouTube, open it in the YouTube app, which casts
// by itself).

import { createHmac, randomBytes } from 'node:crypto';
import { secretsMatch } from '$lib/server/secrets';
import type { BacklogRecord } from './backlog';

/** How long a TV link works. Long enough for an evening's queue. */
export const CAST_TICKET_TTL_SECONDS = 6 * 60 * 60;
/** Longer than this is a film, not a backlog clip — and too much for the server's disk. */
export const CAST_MAX_SECONDS = 30 * 60;
/** yt-dlp's own ceiling on one file, as it spells it. */
export const CAST_FILE_MAX = '600M';
/** The whole cache, oldest file out first. */
export const CAST_CACHE_BYTES = 2 * 1024 ** 3;
/** Never start a fetch that would leave the disk with less than this. */
export const CAST_MIN_FREE_BYTES = 5 * 1024 ** 3;
/** A cached file not asked for again in this long is removed. */
export const CAST_CACHE_SECONDS = CAST_TICKET_TTL_SECONDS;
/** A fetch that failed is not tried again for this long; the phone gets the fallback. */
export const CAST_RETRY_SECONDS = 10 * 60;

export type CastFallback = 'mirror' | 'youtube_app';

export type CastWire =
  | {
      state: 'ready';
      mediaUrl: string;
      contentType: 'video/mp4';
      title: string;
      posterUrl: string | null;
      durationSeconds: number | null;
      expiresAt: string;
    }
  | { state: 'preparing'; retryAfterSeconds: number }
  | { state: 'fallback'; fallback: CastFallback; reason: string; url: string | null };

const FETCHABLE = new Set(['youtube', 'tiktok', 'instagram']);

/** Can this item be fetched as a video at all — or straight to the fallback, and why. */
export function castRoute(item: Pick<BacklogRecord, 'kind' | 'url' | 'provider'>): { fetch: true } | { fetch: false; fallback: CastWire } {
  if (!item.url) {
    return { fetch: false, fallback: fallback(item, 'There is nothing to play — it is an idea, not a link.') };
  }
  if (item.kind !== 'video' || !FETCHABLE.has(item.provider ?? '')) {
    return { fetch: false, fallback: fallback(item, 'A web page cannot play on the TV by itself. Open it here and mirror the screen.') };
  }
  return { fetch: true };
}

/** The phone's way out when the server cannot hand the TV a file. */
export function fallback(item: Pick<BacklogRecord, 'url' | 'provider'>, reason: string): Extract<CastWire, { state: 'fallback' }> {
  return {
    state: 'fallback',
    fallback: item.provider === 'youtube' && item.url ? 'youtube_app' : 'mirror',
    reason,
    url: item.url ?? null,
  };
}

/** What a failed yt-dlp run means for the family, in their words. */
export function failureReason(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('login') || s.includes('cookies') || s.includes('sign in') || s.includes('private')) {
    return 'That one needs a login to fetch, so it cannot go to the TV directly.';
  }
  if (s.includes('unavailable') || s.includes('removed') || s.includes('not available') || s.includes('404')) {
    return 'That video seems to have gone.';
  }
  return 'The video could not be fetched for the TV.';
}

/**
 * yt-dlp's argv for one item. Only the YouTube, TikTok and Instagram
 * extractors may run: the generic extractor would follow any link anywhere,
 * which from a server is a way to make it fetch things for someone.
 * H.264 + AAC first, because that is what every Chromecast and AirPlay TV
 * plays; 720p at most, which a living-room TV shows well and the disk can hold.
 */
export function ytDlpArgs(url: string, outputTemplate: string): string[] {
  return [
    '--no-playlist', '--no-progress', '--no-warnings', '--quiet', '--no-mtime', '--no-cache-dir',
    '--use-extractors', 'youtube,tiktok,instagram',
    '--match-filter', `!is_live & duration<=?${CAST_MAX_SECONDS}`,
    '--max-filesize', CAST_FILE_MAX,
    '-f', 'bv*+ba/b',
    '-S', 'vcodec:h264,res:720,acodec:aac',
    '--merge-output-format', 'mp4',
    '--remux-video', 'mp4',
    '-o', outputTemplate,
    '--print', 'after_move:filepath',
    '--', url,
  ];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`backlog-cast.${payload}`, 'utf8').digest('hex');
}

/**
 * A link a TV can fetch without a login: `<item id>.<expires>.<nonce>.<hmac>`.
 * The item id is inside the signed material, so a ticket opens one file only;
 * the file route also re-checks the item still exists, so deleting the item
 * kills its links.
 */
export function issueCastTicket(itemId: string, secret: string, nowMs = Date.now()): { ticket: string; expiresAt: Date } {
  if (!secret) throw new Error('AUTH_SECRET is required to issue a cast ticket');
  if (!UUID.test(itemId)) throw new Error('A cast ticket needs an item id');
  const expires = Math.floor(nowMs / 1000) + CAST_TICKET_TTL_SECONDS;
  const payload = `${itemId}.${expires}.${randomBytes(16).toString('hex')}`;
  return { ticket: `${payload}.${signature(secret, payload)}`, expiresAt: new Date(expires * 1000) };
}

/** The item id a ticket opens, or null for anything malformed, forged or expired. */
export function verifyCastTicket(ticket: string | undefined, secret: string | undefined, nowMs = Date.now()): string | null {
  if (!ticket || !secret) return null;
  const m = /^([0-9a-f-]{36})\.(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/u.exec(ticket);
  if (!m || !UUID.test(m[1])) return null;
  const expires = Number(m[2]);
  const now = Math.floor(nowMs / 1000);
  if (expires < now || expires > now + CAST_TICKET_TTL_SECONDS) return null;
  return secretsMatch(signature(secret, `${m[1]}.${m[2]}.${m[3]}`), m[4]) ? m[1] : null;
}

/** The TV's URL for a ticket. `.mp4` on the end because some receivers sniff the path. */
export function castMediaPath(ticket: string): string {
  return `/cast/${ticket}.mp4`;
}

/** The ticket out of a `/cast/<ticket>.mp4` path segment. */
export function ticketFromSegment(segment: string): string {
  return segment.endsWith('.mp4') ? segment.slice(0, -4) : segment;
}
