/**
 * The writing desk's checklist endpoint.
 *
 *   GET   -> { items, blockers }        the current checklist
 *   PATCH -> { id, status } -> { ok }   the author's verdict on one item
 *   POST  -> NDJSON stream              run the checks
 *
 * Owner-gated by hooks.server.ts like everything under /api/admin — there is
 * deliberately no auth code, no allow-list entry and no rate-limit entry here.
 *
 * WHY POST STREAMS. A full run is one extraction call, then a search and a
 * verdict call for each of up to eight claims: tens of seconds. A JSON endpoint
 * would spend all of it behind a spinner that cannot say whether it is working
 * or wedged, and the deterministic findings — which are ready in milliseconds —
 * would be held hostage to the slowest lane. So the stages report as they land,
 * in the shape `/api/admin/blog/review-claims` already established.
 */

import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import { plainTextFromHtml } from '$lib/blog/readability';
import { runDeterministicChecks, type PostForChecks } from '$lib/blog/desk/checks';
import type { CheckKind, CheckStatus, Finding } from '$lib/blog/desk/types';
import {
  itemBelongsToPost,
  listChecklist,
  openBlockerCount,
  setItemStatus,
  sweepStaleItems,
  upsertFindings,
} from '$lib/blog/desk/store.server';
import { extractClaims, groundClaim, verdictToFinding } from '$lib/blog/desk/ground.server';
import type { RequestHandler } from './$types';

/** Copied from the review-claims endpoint, which pays the same Tavily bill. */
const SEARCH_CONCURRENCY = 3;

/**
 * The kinds `runDeterministicChecks` re-derives on every run, and therefore the
 * only ones its sweep may retire.
 *
 * 'claim' is absent on purpose and added below only when the grounded lane
 * actually finished — sweeping it after a failed extraction would dismiss every
 * stored claim finding on the strength of having learned nothing. 'voice' is
 * absent because nothing in this route produces it; a lane must never retire
 * another lane's findings.
 */
const DETERMINISTIC_KINDS: CheckKind[] = ['meta', 'consistency', 'link', 'alt-text', 'readability'];

const STATUSES: CheckStatus[] = ['open', 'resolved', 'dismissed'];
const isStatus = (v: unknown): v is CheckStatus => typeof v === 'string' && STATUSES.includes(v as CheckStatus);

function postIdFrom(params: { id: string }): number | null {
  const id = Number.parseInt(params.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type LoadedPost = PostForChecks & { contentFormat: string };

async function loadPost(id: number): Promise<LoadedPost | null> {
  const [row] = await db
    .select({
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      slug: blogPosts.slug,
      content: blogPosts.content,
      contentFormat: blogPosts.contentFormat,
      coverImageUrl: blogPosts.coverImageUrl,
      coverImageAlt: blogPosts.coverImageAlt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.id, id))
    .limit(1);
  if (!row) return null;

  const tags = await db.select({ tag: blogPostTags.tag }).from(blogPostTags).where(eq(blogPostTags.postId, id));

  return {
    title: row.title ?? '',
    excerpt: row.excerpt ?? '',
    slug: row.slug ?? '',
    contentHtml: row.content ?? '',
    contentFormat: row.contentFormat ?? 'html',
    coverImageUrl: row.coverImageUrl,
    coverImageAlt: row.coverImageAlt,
    tags: tags.map((t) => t.tag),
  };
}

/**
 * Overlay the editor's unsaved buffer, if it sent one.
 *
 * The deterministic checks are designed to run against a draft that has not
 * been saved (see `PostForChecks` in $lib/blog/desk/checks), and the desk is
 * most useful in the seconds before a publish — which is exactly when the
 * editor holds text the row does not. Only fields actually present are taken,
 * so a panel that sends `{ excerpt }` alone does not blank the body.
 *
 * The findings this produces are keyed on the UNSAVED text. That is correct and
 * worth knowing: save-then-rerun is what makes them line up with what is stored,
 * and the sweep is what retires the ones that were about text since replaced.
 */
function applyDraft(post: LoadedPost, draft: unknown): LoadedPost {
  if (!draft || typeof draft !== 'object') return post;
  const d = draft as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

  return {
    ...post,
    title: str(d.title) ?? post.title,
    excerpt: str(d.excerpt) ?? post.excerpt,
    slug: str(d.slug) ?? post.slug,
    contentHtml: str(d.contentHtml) ?? str(d.content) ?? post.contentHtml,
    contentFormat: str(d.contentFormat) ?? post.contentFormat,
    // `null` is a real value for these two — it is how the cover is cleared —
    // so `undefined` is the only thing that means "not sent".
    coverImageUrl: d.coverImageUrl === undefined ? post.coverImageUrl : str(d.coverImageUrl) ?? null,
    coverImageAlt: d.coverImageAlt === undefined ? post.coverImageAlt : str(d.coverImageAlt) ?? null,
    tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : post.tags,
  };
}

/** Markdown bodies are already close enough to plain text; running the HTML
 *  stripper over one eats anything in angle brackets. Same branch the
 *  review-claims endpoint takes. */
const plainBody = (post: LoadedPost) =>
  post.contentFormat === 'markdown' ? post.contentHtml : plainTextFromHtml(post.contentHtml);

// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ params, url }) => {
  const postId = postIdFrom(params);
  if (postId === null) return json({ error: 'Invalid post id' }, { status: 400 });

  // Defaults to open items — the checklist. `?status=all` is how the panel
  // shows what has already been dealt with.
  const requested = url.searchParams.get('status');
  const status = requested === 'all' || isStatus(requested) ? requested : 'open';

  const [items, blockers] = await Promise.all([listChecklist(postId, { status }), openBlockerCount(postId)]);
  return json({ items, blockers });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const postId = postIdFrom(params);
  if (postId === null) return json({ error: 'Invalid post id' }, { status: 400 });

  let body: { id?: unknown; status?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Invalid item id' }, { status: 400 });
  if (!isStatus(body?.status)) {
    return json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 });
  }

  // Scope the write to this post. The id is the item's, not the post's, so
  // without this a PATCH under one post's path silently edits another's
  // checklist — see itemBelongsToPost.
  if (!(await itemBelongsToPost(id, postId))) return json({ error: 'Not found' }, { status: 404 });

  await setItemStatus(id, body.status);
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = postIdFrom(params);
  if (postId === null) return json({ error: 'Invalid post id' }, { status: 400 });

  // An empty body is the normal case — "check what is saved". Only a body that
  // is present and malformed is worth a 400, and even then it is not, because
  // the run would be identical; so a parse failure just means no draft.
  let body: { draft?: unknown; skipGrounding?: unknown } = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }

  const stored = await loadPost(postId);
  if (!stored) return json({ error: 'Not found' }, { status: 404 });

  const post = applyDraft(stored, body.draft);
  const skipGrounding = body.skipGrounding === true;
  const runId = crypto.randomUUID();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        // --- 1. the deterministic lane -----------------------------------
        // Pure, synchronous and reproducible from the post text alone, which is
        // what earns it the right to raise a 'blocker'. It is also the half
        // that must survive whatever the network does next, so it is written
        // first and nothing below can roll it back.
        send({ type: 'phase', phase: 'checks', message: 'Running the deterministic checks…' });

        const findings = runDeterministicChecks(post);
        const written = await upsertFindings(postId, findings, runId);
        send({
          type: 'checks-done',
          found: findings.length,
          created: written.created,
          updated: written.updated,
        });

        const sweepKinds: CheckKind[] = [...DETERMINISTIC_KINDS];

        // --- 2 + 3. the grounded lane ------------------------------------
        // Everything from here is best-effort. A Tavily outage, a model that
        // returns prose instead of JSON, a claim whose search times out: none
        // of it may cost the findings already stored above, so the whole lane
        // sits inside one catch and reports rather than throws.
        if (!skipGrounding) {
          try {
            send({ type: 'phase', phase: 'extracting', message: 'Reading the draft for checkable claims…' });
            const claims = await extractClaims(plainBody(post));
            send({ type: 'claims-found', count: claims.length });

            let failures = 0;

            if (claims.length) {
              send({
                type: 'phase',
                phase: 'grounding',
                message: `Checking ${claims.length} claim${claims.length === 1 ? '' : 's'} against the web…`,
              });

              // A shared cursor rather than a chunked loop: claims take wildly
              // different times (a cached query against a slow site), and
              // chunking would idle two workers waiting on the third.
              let cursor = 0;
              const worker = async () => {
                while (cursor < claims.length) {
                  const index = cursor++;
                  const claim = claims[index];
                  send({ type: 'claim-start', index, claim: claim.claim, query: claim.searchQuery });
                  try {
                    const verdict = await groundClaim(claim);
                    const finding: Finding = verdictToFinding(claim, verdict);
                    // Upserted one at a time so a failure at claim six keeps
                    // the five verdicts already paid for.
                    await upsertFindings(postId, [finding], runId);
                    send({
                      type: 'claim-done',
                      index,
                      stance: verdict.stance,
                      confidence: verdict.confidence,
                      severity: finding.severity,
                      sources: verdict.evidence.length,
                    });
                  } catch (e) {
                    failures++;
                    send({
                      type: 'claim-done',
                      index,
                      stance: 'unclear',
                      confidence: 0,
                      sources: 0,
                      error: e instanceof Error ? e.message : 'claim check failed',
                    });
                  }
                }
              };

              await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, claims.length) }, worker));
            }

            // 'claim' joins the sweep only if every claim this run raised was
            // actually written. One failed lookup means one claim finding was
            // not re-stamped with this runId, and sweeping would then dismiss a
            // finding that is still true — the author would watch it vanish for
            // no reason he can see. Zero claims with zero failures is the
            // legitimate case where the sweep SHOULD clear the old ones: the
            // factual sentences have been edited out of the post.
            if (failures === 0) sweepKinds.push('claim');
            else send({ type: 'error', error: `${failures} claim check${failures === 1 ? '' : 's'} failed; existing claim findings left in place` });
          } catch (e) {
            send({ type: 'error', error: e instanceof Error ? e.message : 'claim checking failed' });
          }
        }

        // --- 4. retire what this run did not raise again ------------------
        send({ type: 'phase', phase: 'sweeping', message: 'Retiring findings whose text has changed…' });
        const swept = await sweepStaleItems(postId, runId, sweepKinds);

        // --- 5. the settled checklist -------------------------------------
        // Returned in the done event rather than left to a follow-up GET: the
        // panel would otherwise race its own re-fetch against the sweep it just
        // triggered and paint a list one state behind.
        const [items, blockers] = await Promise.all([listChecklist(postId), openBlockerCount(postId)]);
        send({ type: 'done', runId, swept, blockers, items });
      } catch (e) {
        send({ type: 'error', error: e instanceof Error ? e.message : 'unknown error' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      // nginx buffers a proxied response by default, which turns a stream into
      // one delivery at the end and undoes the entire point of it.
      'X-Accel-Buffering': 'no',
    },
  });
};
