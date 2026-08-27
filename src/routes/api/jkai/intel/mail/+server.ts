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
 * Threads one request may admit.
 *
 * Each admission is a Gmail round trip, a model call and an embedding batch —
 * roughly a second and a half of work. A "admit all 300 of linkedin.com" click
 * has to be bounded or it is a request that cannot finish inside any sensible
 * timeout, and the owner would be left unable to tell a slow request from a
 * failed one. The response says how many were left so the UI can offer to
 * continue.
 */
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
      const result = await admitMailNotes(batch, { actor: 'owner', reason });
      return json({ ...result, remaining: Math.max(0, noteIds.length - batch.length) });
    }
    if (action === 'reject') {
      const batch = noteIds.slice(0, MAX_REJECT_PER_REQUEST);
      const result = await rejectMailNotes(batch, { actor: 'owner', reason });
      return json({ ...result, remaining: Math.max(0, noteIds.length - batch.length) });
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
