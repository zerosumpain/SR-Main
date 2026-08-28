// The admission queue's actions.
//
//   GET                            the whole queue — counts, suggestions, clusters, rows
//   POST { action, noteIds }       admit | reject | requeue | similar
//
// Owner-gated by hooks.server.ts like every other /api/jkai route. The work
// lives in $lib/jkai/intel/mail-*; this route validates and shapes.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadMailQueue, similarPending, backfillPendingEmbeddings } from '$lib/jkai/intel/mail-queue';
import { admitMailNotes, rejectMailNotes, requeueMailNotes } from '$lib/jkai/intel/mail-admit';

/**
 * How long one admit request will work before handing the rest back.
 *
 * The site sits behind a Cloudflare tunnel, which gives up on a request at 100
 * seconds. Admission costs 27–50 SECONDS per thread on production — a Gmail
 * round trip, attachment downloads, a Codex extraction and an embedding batch —
 * so a request for four threads ran past that limit, the owner's browser got a
 * 524, and the mail was admitted anyway while the page still showed it pending.
 * Seen 2026-08-27 19:52–19:54.
 *
 * 60s leaves room for the slowest single thread to finish after the last budget
 * check and still land inside the proxy's window. The client re-sends whatever
 * comes back in `remaining`.
 */
const ADMIT_BUDGET_MS = 60_000;

/** A hard ceiling as well as the time budget, so one request can never hold a
 *  connection open on a pathological list even if every thread is instant. */
const MAX_ADMIT_PER_REQUEST = 40;
/** Rejections are a single UPDATE and a ledger write, so they scale far higher. */
const MAX_REJECT_PER_REQUEST = 1000;

function readIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
}

export const GET: RequestHandler = async () => {
  const queue = await loadMailQueue();
  return json(queue);
};

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const noteIds = readIds(body.noteIds);
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined;

  if (action === 'backfill-embeddings') {
    // Held threads captured before the gate existed carry a content hash, so
    // the sweep will never re-read them and they would stay unembedded — and
    // therefore invisible to "find more like this" — indefinitely.
    return json(await backfillPendingEmbeddings());
  }

  if (action === 'similar') {
    const [noteId] = noteIds;
    if (!noteId) return json({ error: 'similar needs one note id.' }, { status: 400 });
    return json({ noteIds: await similarPending(noteId) });
  }

  if (!noteIds.length) return json({ error: 'No threads given.' }, { status: 400 });

  try {
    if (action === 'admit') {
      const batch = noteIds.slice(0, MAX_ADMIT_PER_REQUEST);
      const result = await admitMailNotes(batch, {
        actor: 'owner',
        reason,
        budgetMs: ADMIT_BUDGET_MS,
      });
      // Everything the caller asked for that this request did not get to: what
      // the time budget deferred, plus anything past the hard cap.
      return json({
        ...result,
        remaining: [...result.remaining, ...noteIds.slice(MAX_ADMIT_PER_REQUEST)],
      });
    }
    if (action === 'reject') {
      // No time budget: a rejection is one UPDATE and a ledger write, so a
      // thousand of them finish in well under the proxy's window.
      const batch = noteIds.slice(0, MAX_REJECT_PER_REQUEST);
      const result = await rejectMailNotes(batch, { actor: 'owner', reason });
      return json({ ...result, remaining: noteIds.slice(MAX_REJECT_PER_REQUEST) });
    }
    if (action === 'requeue') {
      return json({ requeued: await requeueMailNotes(noteIds.slice(0, MAX_REJECT_PER_REQUEST)) });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Gmail auth is the caller's problem to fix, not a 500 to be puzzled over.
    const status = /re-authentication|invalid_grant|no active gmail account/i.test(message) ? 409 : 502;
    return json({ error: message }, { status });
  }

  return json({ error: `Unknown action "${action}".` }, { status: 400 });
};
