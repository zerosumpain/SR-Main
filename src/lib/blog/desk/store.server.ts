/**
 * Persistence for the writing desk's checklist.
 *
 * Server-only by name. The pure half of the desk — `./checks`, `./anchor`,
 * `./types` — is shared with the browser so the editor can run the
 * deterministic lane on every idle keystroke; nothing in this file is.
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE: a re-run must never resurrect a
 * finding the author has already dealt with. The old assistant re-listed every
 * suggestion on every pass, so the only rational response was to stop reading
 * it. Two mechanisms hold the line, and both are load-bearing:
 *
 *   1. `upsertFindings` writes through the (post_id, anchor_hash, kind) unique
 *      index and never touches `status`. Same text, same hash, same row.
 *   2. `sweepStaleItems` retires OPEN items from superseded runs only, so a
 *      finding whose sentence has been edited away disappears, and one the
 *      author resolved or dismissed by hand stays exactly as he left it.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { blogChecklistItems } from '$lib/db/schema';
import type { ChecklistItem, CheckKind, CheckSeverity, CheckStatus, Evidence, Finding } from './types';

/**
 * `ChecklistItem` is declared in ./types, not here, so the editor panel can
 * name the shape it renders without importing a `*.server.ts` module. Re-
 * exported because this module is where it is produced, and a caller that has
 * the function should not have to hunt for the type.
 *
 * The union-typed columns it declares are plain `text` in the table — Drizzle
 * cannot narrow them, so the casts in `toItem` are this module's assertion that
 * nothing else writes the table. The timestamps are `Date`; the API layer
 * JSON-stringifies them to ISO strings, which is what the panel receives.
 */
export type { ChecklistItem };

/**
 * Severity order in SQL.
 *
 * Sorting on the column itself is wrong and looks right: 'blocker' < 'nit' <
 * 'review' alphabetically, so a plain ORDER BY puts nits above the things that
 * actually stop a publish. The CASE is the same ranking `runDeterministicChecks`
 * sorts by in memory, so the panel and the editor's live pass agree.
 */
const SEVERITY_ORDER = sql`case ${blogChecklistItems.severity} when 'blocker' then 0 when 'review' then 1 else 2 end`;

function toItem(row: typeof blogChecklistItems.$inferSelect): ChecklistItem {
  return {
    id: row.id,
    postId: row.postId,
    kind: row.kind as CheckKind,
    severity: row.severity as CheckSeverity,
    title: row.title,
    detail: row.detail,
    anchorText: row.anchorText,
    anchorHash: row.anchorHash,
    evidence: (row.evidence as Evidence[] | null) ?? null,
    status: row.status as CheckStatus,
    runId: row.runId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt
  };
}

/**
 * The checklist for one post.
 *
 * Defaults to OPEN items, because that is what a checklist is. Pass
 * `{ status: 'all' }` to see what has been dealt with — worth having, since
 * "why is that finding not showing" is answered by seeing it sat there
 * dismissed, not by an empty list.
 */
export async function listChecklist(
  postId: number,
  opts?: { status?: CheckStatus | 'all' }
): Promise<ChecklistItem[]> {
  const status = opts?.status ?? 'open';
  const where =
    status === 'all'
      ? eq(blogChecklistItems.postId, postId)
      : and(eq(blogChecklistItems.postId, postId), eq(blogChecklistItems.status, status));

  const rows = await db
    .select()
    .from(blogChecklistItems)
    .where(where)
    // `id` last so the order is total: two findings raised in the same
    // statement share a `created_at` to the microsecond, and an unstable tail
    // makes the panel reshuffle rows on every poll for no reason.
    .orderBy(SEVERITY_ORDER, blogChecklistItems.createdAt, blogChecklistItems.id);

  return rows.map(toItem);
}

/**
 * Write a run's findings, updating in place where they already exist.
 *
 * IDEMPOTENCY IS THE WHOLE DESIGN. The conflict target is the stored unique
 * index (post_id, anchor_hash, kind), so re-running over unchanged text UPDATES
 * the same rows and can never duplicate them — that is what makes it safe to
 * run on every save, and it is why `anchorHash` has to be computed the same way
 * on both sides (see ./anchor).
 *
 * WHAT MAY MOVE, and what may not:
 *   - title / detail / evidence / anchorText / severity / runId / updatedAt are
 *     facts about the FINDING and are refreshed from the new run. anchorText is
 *     in that list because the hash is taken over a normalised form (tags
 *     stripped, whitespace collapsed, lowercased), so the raw snippet can drift
 *     while the key holds — and a stale snippet is a scroll-to target that
 *     lands in the wrong paragraph. severity is in it because a grounded claim
 *     can harden from 'nit' to 'review' between runs; for the deterministic
 *     lane the rule id is part of the hash, so severity there is constant and
 *     the write is a no-op.
 *   - `status` and `resolvedAt` are the AUTHOR's, and are never in the SET
 *     clause. An upsert that reopened a resolved item would replay every
 *     finding he had already handled, which is precisely the noise that got the
 *     old assistant ignored. If you are adding a column here, ask which of the
 *     two categories it is in before you add it to the set.
 */
export async function upsertFindings(
  postId: number,
  findings: Finding[],
  runId: string
): Promise<{ created: number; updated: number }> {
  if (!findings.length) return { created: 0, updated: 0 };

  // Collapse duplicates WITHIN the batch first. Postgres refuses an ON CONFLICT
  // DO UPDATE whose statement would touch one row twice ("cannot affect row a
  // second time") — it is an error, not a silent merge, so a single pair of
  // colliding findings loses the entire run. `runDeterministicChecks` already
  // dedupes its own output; the claim lane does not, and two extracted claims
  // quoting the same sentence hash identically.
  const seen = new Set<string>();
  const batch: Finding[] = [];
  for (const f of findings) {
    const key = `${f.kind} ${f.anchorHash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    batch.push(f);
  }

  // Which of these already exist, asked before the write.
  //
  // The alternative is the `RETURNING xmax = 0` trick, which tells an insert
  // from an update inside the statement itself. It works, and it reads as a
  // typo to everyone who meets it — one extra indexed SELECT on a
  // single-author admin path is a fair price for a line anyone can maintain.
  const existing = await db
    .select({ kind: blogChecklistItems.kind, anchorHash: blogChecklistItems.anchorHash })
    .from(blogChecklistItems)
    .where(
      and(
        eq(blogChecklistItems.postId, postId),
        inArray(
          blogChecklistItems.anchorHash,
          batch.map((f) => f.anchorHash)
        )
      )
    );
  const known = new Set(existing.map((r) => `${r.kind} ${r.anchorHash}`));

  const now = new Date();
  await db
    .insert(blogChecklistItems)
    .values(
      batch.map((f) => ({
        postId,
        kind: f.kind,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        anchorText: f.anchorText,
        anchorHash: f.anchorHash,
        // `?? null` rather than leaving it undefined: a lane that used to
        // return evidence and now does not should clear the old sources, not
        // leave the panel citing a search nobody ran.
        evidence: f.evidence ?? null,
        status: 'open' as const,
        runId,
        createdAt: now,
        updatedAt: now
      }))
    )
    .onConflictDoUpdate({
      target: [blogChecklistItems.postId, blogChecklistItems.anchorHash, blogChecklistItems.kind],
      set: {
        title: sql`excluded.title`,
        detail: sql`excluded.detail`,
        severity: sql`excluded.severity`,
        anchorText: sql`excluded.anchor_text`,
        evidence: sql`excluded.evidence`,
        runId: sql`excluded.run_id`,
        updatedAt: now
        // NO status. NO resolvedAt. See the doc comment above.
      }
    });

  const created = batch.filter((f) => !known.has(`${f.kind} ${f.anchorHash}`)).length;
  return { created, updated: batch.length - created };
}

/**
 * The author's verdict on one item.
 *
 * `resolvedAt` tracks the decision, not the row's last write: it is set when
 * the item leaves 'open' and cleared when it comes back, so "when did he deal
 * with this" survives a later re-run refreshing the title.
 */
export async function setItemStatus(id: number, status: CheckStatus): Promise<void> {
  await db
    .update(blogChecklistItems)
    .set({
      status,
      updatedAt: new Date(),
      resolvedAt: status === 'open' ? null : new Date()
    })
    .where(eq(blogChecklistItems.id, id));
}

/**
 * Does this item belong to this post?
 *
 * The route needs it because PATCH takes a bare item id under a post-scoped
 * path, and without the check a PATCH to `/api/admin/blog/5/desk` can flip an
 * item on post 9. Everything under /api/admin is owner-gated, so this is not a
 * security boundary — it is the difference between a 404 and a silent write to
 * the wrong post's checklist, which is the kind of bug that gets diagnosed as
 * "the panel is haunted".
 */
export async function itemBelongsToPost(id: number, postId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: blogChecklistItems.id })
    .from(blogChecklistItems)
    .where(and(eq(blogChecklistItems.id, id), eq(blogChecklistItems.postId, postId)))
    .limit(1);
  return !!row;
}

/**
 * Retire open items that this run did not raise again.
 *
 * These are findings whose anchoring sentence has since been edited away: the
 * text changed, so the hash changed, so the new run wrote a different row and
 * this one was left behind pointing at prose that no longer exists.
 *
 * Three constraints, all deliberate:
 *   - OPEN only. An item the author resolved or dismissed himself is his record
 *     of a decision; a sweep must not overwrite it.
 *   - Scoped to `kinds`, so a run that only did the deterministic lane cannot
 *     retire the claim findings a grounded run left behind — and neither can
 *     ever touch 'voice', which is a different lane's business entirely. The
 *     caller must pass ONLY the kinds it actually re-derived this run.
 *   - `is distinct from` rather than `<>`, because `run_id <> $1` evaluates to
 *     NULL — and so is not true — for any row written before this column was
 *     populated, and `<>` would therefore leave exactly the stalest items in
 *     place forever.
 *
 * `resolvedAt` stays null: a sweep is not an author decision, and keeping that
 * column meaning only "he acted on it" is what lets the two be told apart.
 */
export async function sweepStaleItems(
  postId: number,
  runId: string,
  kinds: CheckKind[]
): Promise<number> {
  if (!kinds.length) return 0;

  const swept = await db
    .update(blogChecklistItems)
    .set({ status: 'dismissed', updatedAt: new Date() })
    .where(
      and(
        eq(blogChecklistItems.postId, postId),
        eq(blogChecklistItems.status, 'open'),
        inArray(blogChecklistItems.kind, kinds),
        sql`${blogChecklistItems.runId} is distinct from ${runId}`
      )
    )
    .returning({ id: blogChecklistItems.id });

  return swept.length;
}

/**
 * How many open blockers stand between this post and publish.
 *
 * A plain COUNT with the predicate in the WHERE, which the
 * (post_id, status, severity) index serves. Do NOT rewrite this as
 * `count(*) filter (where ...)` over the whole post: an aggregate FILTER is
 * applied after the rows are read, so it can never use an index.
 */
export async function openBlockerCount(postId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(blogChecklistItems)
    .where(
      and(
        eq(blogChecklistItems.postId, postId),
        eq(blogChecklistItems.status, 'open'),
        eq(blogChecklistItems.severity, 'blocker')
      )
    );
  return row?.n ?? 0;
}
