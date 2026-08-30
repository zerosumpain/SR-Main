/**
 * Comment persistence and moderation.
 *
 * Server-only by name. The pure half — validation and spam triage — is in
 * `./comments` and is shared with the browser; nothing here is.
 *
 * The guards are imported from `$lib/space-lander/guard` rather than
 * reimplemented. They are generic HTTP guards that happen to have been written
 * first for the Terminal Descent leaderboard, and this codebase has already
 * paid for the alternative: the sensitive-data detector existed in three copies
 * and they drifted. `clientIp` in particular is not optional — behind
 * cloudflared every request to the VPS appears to come from 127.0.0.1, so
 * `getClientAddress()` on its own is not an identity at all.
 *
 * (They would sit better under `$lib/server/`. Moving them is a separate
 * change: `src/lib/server/**` is a protected path, and a file move there would
 * raise this PR's risk tier for no functional gain.)
 */

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { blogComments, blogPosts } from '$lib/db/schema';
import { hashIp, clientIp, rateLimit, maybeSweep } from '$lib/space-lander/guard';
import type { PublicComment, ValidComment } from './comments';

export type CommentStatus = 'held' | 'published' | 'spam' | 'deleted';

/**
 * Burst and sustained ceilings for one address.
 *
 * Both are in-process and reset on deploy — CI deploys on every merge, so
 * these are best-effort. The durable ceiling is `postsFromAuthorSince` below,
 * which counts rows and is what `blog_comments_author_created_idx` exists for.
 */
const BURST_MAX = 3;
const BURST_WINDOW_MS = 60_000;
const HOURLY_MAX = 10;
const HOURLY_WINDOW_MS = 60 * 60_000;
/** Durable ceiling, survives a deploy. */
const DAILY_MAX = 25;

export type GuardOutcome = { allowed: true; authorHash: string } | { allowed: false; retryAfterSec: number };

export async function guardCommentPost(
  request: Request,
  getClientAddress: () => string,
): Promise<GuardOutcome> {
  maybeSweep();
  const authorHash = hashIp(clientIp(request, getClientAddress));

  if (!rateLimit('blog-comment', authorHash, BURST_MAX, BURST_WINDOW_MS)) {
    return { allowed: false, retryAfterSec: 60 };
  }
  if (!rateLimit('blog-comment-hour', authorHash, HOURLY_MAX, HOURLY_WINDOW_MS)) {
    return { allowed: false, retryAfterSec: 900 };
  }

  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(blogComments)
    .where(and(eq(blogComments.authorHash, authorHash), gte(blogComments.createdAt, since)));
  if ((row?.n ?? 0) >= DAILY_MAX) {
    return { allowed: false, retryAfterSec: 3600 };
  }

  return { allowed: true, authorHash };
}

/** The published post a comment is being attached to, or null. Drafts and
 *  unknown slugs are indistinguishable to the caller on purpose — a comment
 *  form is not a probe for unpublished slugs. */
export async function publishedPostIdBySlug(slug: string): Promise<number | null> {
  const [row] = await db
    .select({ id: blogPosts.id })
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.status, 'published')))
    .limit(1);
  return row?.id ?? null;
}

export async function insertComment(
  postId: number,
  value: ValidComment,
  authorHash: string,
  parentId: number | null,
): Promise<void> {
  // A reply must belong to the same post, and may not itself be a reply —
  // threading is one level deep by design, so the render can never need a
  // recursive query. An invalid parent degrades to a top-level comment rather
  // than failing the post: the reader wrote something real either way.
  let resolvedParent: number | null = null;
  if (parentId !== null) {
    const [parent] = await db
      .select({ id: blogComments.id, parentId: blogComments.parentId, postId: blogComments.postId })
      .from(blogComments)
      .where(eq(blogComments.id, parentId))
      .limit(1);
    if (parent && parent.postId === postId && parent.parentId === null) resolvedParent = parent.id;
  }

  await db.insert(blogComments).values({
    postId,
    parentId: resolvedParent,
    authorName: value.authorName,
    body: value.body,
    // Held unless the heuristics already think it is junk, in which case it
    // starts in the spam queue. Neither state is visible to a reader.
    status: value.spam ? 'spam' : 'held',
    authorHash,
  });
}

/** Comments a reader may see: published only, oldest first, replies included. */
export async function publishedComments(postId: number): Promise<PublicComment[]> {
  const rows = await db
    .select({
      id: blogComments.id,
      parentId: blogComments.parentId,
      authorName: blogComments.authorName,
      body: blogComments.body,
      createdAt: blogComments.createdAt,
    })
    .from(blogComments)
    .where(and(eq(blogComments.postId, postId), eq(blogComments.status, 'published')))
    .orderBy(blogComments.createdAt);

  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    authorName: r.authorName,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function publishedCommentCounts(postIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!postIds.length) return out;
  const rows = await db
    .select({ postId: blogComments.postId, n: sql<number>`count(*)::int` })
    .from(blogComments)
    .where(and(inArray(blogComments.postId, postIds), eq(blogComments.status, 'published')))
    .groupBy(blogComments.postId);
  for (const r of rows) out.set(r.postId, r.n);
  return out;
}

export type ModerationComment = PublicComment & {
  postId: number;
  postSlug: string;
  postTitle: string;
  status: CommentStatus;
};

/** The owner's queue. Anything not yet published, newest first. */
export async function moderationQueue(status: CommentStatus | 'all', limit = 100): Promise<ModerationComment[]> {
  const where =
    status === 'all' ? undefined : eq(blogComments.status, status);

  const rows = await db
    .select({
      id: blogComments.id,
      parentId: blogComments.parentId,
      authorName: blogComments.authorName,
      body: blogComments.body,
      createdAt: blogComments.createdAt,
      status: blogComments.status,
      postId: blogComments.postId,
      postSlug: blogPosts.slug,
      postTitle: blogPosts.title,
    })
    .from(blogComments)
    .innerJoin(blogPosts, eq(blogComments.postId, blogPosts.id))
    .where(where)
    .orderBy(desc(blogComments.createdAt))
    .limit(Math.min(limit, 500));

  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    authorName: r.authorName,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    status: r.status as CommentStatus,
    postId: r.postId,
    postSlug: r.postSlug,
    postTitle: r.postTitle,
  }));
}

export async function setCommentStatus(id: number, status: CommentStatus): Promise<void> {
  await db
    .update(blogComments)
    .set({ status, moderatedAt: new Date() })
    .where(eq(blogComments.id, id));
}

export async function commentStatusCounts(): Promise<Record<CommentStatus, number>> {
  const rows = await db
    .select({ status: blogComments.status, n: sql<number>`count(*)::int` })
    .from(blogComments)
    .groupBy(blogComments.status);
  const out: Record<CommentStatus, number> = { held: 0, published: 0, spam: 0, deleted: 0 };
  for (const r of rows) {
    if (r.status in out) out[r.status as CommentStatus] = r.n;
  }
  return out;
}
