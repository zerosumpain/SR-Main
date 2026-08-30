import { json } from '@sveltejs/kit';
import {
  commentStatusCounts,
  moderationQueue,
  setCommentStatus,
  type CommentStatus,
} from '$lib/blog/comments.server';
import type { RequestHandler } from './$types';

/**
 * Comment moderation, owner-only.
 *
 * No auth code here on purpose: everything under /api/admin is already behind
 * the owner gate in hooks.server.ts, and a second check in the handler is a
 * second thing that can drift out of step with the first.
 *
 * The two allow-lists below are the load-bearing part of this file.
 * `setCommentStatus` writes whatever string it is handed straight into the
 * status column and `moderationQueue` drops it into a WHERE clause, so an
 * unvalidated value from a request body would make the database the thing
 * deciding what a valid state is. Both lists are closed literals.
 */

/** States a comment can be PUT INTO. */
const WRITABLE = ['held', 'published', 'spam', 'deleted'] as const;

/** States that can be ASKED FOR. 'all' is a query filter and never a stored
 *  value, which is exactly why it is not in WRITABLE — a PATCH to 'all' has to
 *  be a 400, not a row whose status is the word "all". */
const READABLE = [...WRITABLE, 'all'] as const;

type ReadableStatus = (typeof READABLE)[number];

const DEFAULT_LIMIT = 100;
/** Mirrors the cap inside `moderationQueue`; stated here so a caller asking for
 *  10,000 gets a predictable page rather than a silently truncated one. */
const MAX_LIMIT = 500;

function isWritable(value: unknown): value is CommentStatus {
  return typeof value === 'string' && (WRITABLE as readonly string[]).includes(value);
}

function isReadable(value: unknown): value is ReadableStatus {
  return typeof value === 'string' && (READABLE as readonly string[]).includes(value);
}

// GET /api/admin/blog/comments?status=held|published|spam|deleted|all&limit=
//
// An unknown `status` falls back to the held queue rather than erroring: this
// is a read with no side effect, and the held queue is the thing the caller
// almost certainly wanted. The resolved value is echoed back so a client that
// asked for something else can tell it did not get it.
export const GET: RequestHandler = async ({ url }) => {
  const requested = url.searchParams.get('status');
  const status: ReadableStatus = isReadable(requested) ? requested : 'held';

  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  // Counts come back on every read, not just the first: the tab strip shows
  // them live, and a queue that says "Held 4" after you have cleared all four
  // is worse than no number at all.
  const [comments, counts] = await Promise.all([
    moderationQueue(status, limit),
    commentStatusCounts(),
  ]);

  return json({ status, comments, counts });
};

// PATCH /api/admin/blog/comments  { id, status }
export const PATCH: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const { id, status } = (body ?? {}) as { id?: unknown; status?: unknown };

  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return json({ error: '`id` must be a positive integer.' }, { status: 400 });
  }
  if (!isWritable(status)) {
    return json(
      { error: `\`status\` must be one of: ${WRITABLE.join(', ')}.` },
      { status: 400 },
    );
  }

  // An id that matches nothing updates nothing and still reports ok. That is
  // deliberate: the only way to get here is the owner double-clicking a row
  // that has already been dealt with, and turning that into an error would put
  // a red banner on a queue that is in exactly the state they wanted.
  await setCommentStatus(id, status);

  return json({ ok: true });
};
