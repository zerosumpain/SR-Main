/**
 * Reading telemetry for one post: dwell, scroll depth, completion.
 *
 * Under `/blog` for the same reason as the comments route next door — the
 * prefix is already public and the slug cannot be carried by an exact-match
 * API entry. `/decks/[slug]/track` is the precedent.
 *
 * ALWAYS 204, whatever happens. A beacon that reports failures is a beacon
 * that leaks: a distinguishable response would tell an anonymous caller which
 * slugs exist as drafts, which post ids are real, and whether their payload
 * was accepted. It also must never make `navigator.sendBeacon` retry.
 *
 * What this stores is bounded on purpose. `sessionId` identifies a READ, not a
 * person: it is minted in sessionStorage, dies with the tab, and is joined to
 * nothing. `referrerHost` is a host and never a full URL. There is no
 * user-agent string, no IP, and no identity of any kind.
 */

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { blogPostViews } from '$lib/db/schema';
import { publishedPostIdBySlug } from '$lib/blog/comments.server';
import type { RequestHandler } from './$types';

const ok = () => new Response(null, { status: 204 });

/** Four hours. Longer than any honest single read, and the beacon already
 *  clamps to the same value — this is the server refusing to trust it. */
const MAX_DWELL_MS = 4 * 60 * 60 * 1000;

const DEVICE_CLASSES = new Set(['mobile', 'tablet', 'desktop']);

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

export const POST: RequestHandler = async ({ params, request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return ok();
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  // A uuid is 36 characters; the fallback the client mints is shorter. Anything
  // outside this band is not something this endpoint issued.
  if (sessionId.length < 8 || sessionId.length > 64) return ok();

  const postId = await publishedPostIdBySlug(params.slug);
  if (postId === null) return ok();

  const dwellMs = intIn(body.dwellMs, 0, MAX_DWELL_MS, 0);
  const maxScrollPct = intIn(body.maxScrollPct, 0, 100, 0);
  const completed = body.completed === true;

  const referrerHostRaw = typeof body.referrerHost === 'string' ? body.referrerHost.trim() : '';
  // Host-shaped or nothing. A path, a query string or a full URL here is either
  // a client bug or an attempt to store free text in a column that is displayed
  // in the admin.
  const referrerHost =
    referrerHostRaw && /^[a-z0-9.-]{1,120}$/i.test(referrerHostRaw) ? referrerHostRaw.toLowerCase() : null;

  const deviceClassRaw = typeof body.deviceClass === 'string' ? body.deviceClass : '';
  const deviceClass = DEVICE_CLASSES.has(deviceClassRaw) ? deviceClassRaw : null;

  try {
    await db
      .insert(blogPostViews)
      .values({ postId, sessionId, dwellMs, maxScrollPct, completed, referrerHost, deviceClass })
      .onConflictDoUpdate({
        target: [blogPostViews.postId, blogPostViews.sessionId],
        set: {
          // GREATEST, not assignment. Beacons arrive repeatedly through one
          // read and can arrive out of order — a later one carrying a smaller
          // total (a restored bfcache page, a racing pagehide) must never
          // shrink what is already recorded.
          dwellMs: sql`greatest(${blogPostViews.dwellMs}, excluded.dwell_ms)`,
          maxScrollPct: sql`greatest(${blogPostViews.maxScrollPct}, excluded.max_scroll_pct)`,
          completed: sql`${blogPostViews.completed} or excluded.completed`,
          // The referrer is only ever known on the first beacon of a read;
          // keep what is already there rather than letting a later null win.
          referrerHost: sql`coalesce(${blogPostViews.referrerHost}, excluded.referrer_host)`,
          deviceClass: sql`coalesce(${blogPostViews.deviceClass}, excluded.device_class)`,
          updatedAt: new Date(),
        },
      });
  } catch (e) {
    // Telemetry never fails a request. A dead write here must not turn into a
    // retry storm from sendBeacon.
    console.error('[blog/track] view upsert failed:', e);
  }

  return ok();
};
