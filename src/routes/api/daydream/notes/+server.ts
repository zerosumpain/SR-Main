// Owner-gated CRUD over the notebook, plus running a review by hand.
//
// NOT in PUBLIC_PATHS and must never be: a notebook is the most private thing
// in daydreaming. Only `/api/daydream/observe` is listed there, as an exact
// path, precisely so siblings like this stay behind the Auth.js gate.
//
// One route with an `action` discriminator, matching
// `/api/daydream/thoughts` — every one of these is the same shape (the owner
// operating on his own notebook) and splitting them across six routes would
// multiply the surface without adding a distinction.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errMsg } from '$lib/daydream/types';
import {
  deleteNote,
  getNote,
  listActions,
  listFolders,
  listNotes,
  saveNote,
  clearSupporting,
  listRecordings,
} from '$lib/daydream/notebook/store';

export const GET: RequestHandler = async () => {
  try {
    const [notes, folders] = await Promise.all([listNotes(), listFolders()]);
    return json({ notes, folders });
  } catch (err) {
    console.error('[notebook] list failed:', errMsg(err));
    return json({ error: errMsg(err) }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'body must be JSON' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined);
  const id = typeof body.id === 'string' ? body.id : '';

  try {
    switch (action) {
      case 'save': {
        // Every field optional: the editor autosaves a title-only note, and a
        // folder change must not have to resend the body.
        const note = await saveNote({
          id: id || undefined,
          title: str('title'),
          body: str('body'),
          folder: str('folder'),
          tags: Array.isArray(body.tags)
            ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string')
            : undefined,
          pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
          status: str('status'),
        });
        return json({ ok: true, note });
      }

      case 'get': {
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const note = await getNote(id);
        if (!note) return json({ error: 'no such note' }, { status: 404 });
        // Recordings ride along with the note rather than costing a second
        // round trip — the same reasoning that ships full bodies in the list.
        const [actions, recordings] = await Promise.all([listActions(id), listRecordings(id)]);
        return json({ note, actions, recordings });
      }

      case 'delete': {
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        // The FK cascades the recording rows; their bytes live in the media
        // store and would otherwise be orphaned there for ever.
        const { orphanedDiskPaths } = await deleteNote(id);
        if (orphanedDiskPaths.length > 0) {
          const { deleteByDiskPath } = await import('$lib/jkai/media/storage');
          await Promise.all(
            orphanedDiskPaths.map((p) =>
              deleteByDiskPath(p).catch((err) =>
                // The note is already gone; a stranded file is not worth
                // failing the request over, but it IS worth saying so.
                console.error('[notebook] could not remove recording file:', p, errMsg(err)),
              ),
            ),
          );
        }
        return json({ ok: true });
      }

      case 'clear_supporting': {
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        await clearSupporting(id);
        return json({ ok: true, note: await getNote(id) });
      }

      // ── Read it now ────────────────────────────────────────────────────
      //
      // The same pass the idle activity runs, asked for by hand. Bounded the
      // same way — the plan goes through the same validator, so a research
      // depth this path is not allowed to ask for is refused here exactly as
      // it would be on a heartbeat tick.
      case 'review_now': {
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const note = await getNote(id);
        if (!note) return json({ error: 'no such note' }, { status: 404 });

        const { reviewNote } = await import('$lib/daydream/notebook/review');
        const { executeNoteAction } = await import('$lib/daydream/notebook/actions');
        const { markReviewed, recordExecuted, recordPlanned, recordRefused } = await import(
          '$lib/daydream/notebook/store'
        );

        const plan = await reviewNote(note);
        if (plan.error) return json({ error: plan.error }, { status: 502 });

        for (const bad of plan.refused) {
          await recordRefused(note.id, bad.kind, bad.title, bad.error);
        }
        let done = 0;
        let failed = 0;
        for (const a of plan.actions) {
          const actionId = await recordPlanned(
            note.id,
            a.kind,
            a.title,
            a.params as unknown as Record<string, unknown>,
          );
          const out = await executeNoteAction(note.id, a);
          await recordExecuted(actionId, out);
          out.ok ? done++ : failed++;
        }
        await markReviewed(note.id, note.title, note.body);

        return json({
          ok: true,
          summary: plan.summary,
          planned: plan.actions.length,
          done,
          failed,
          refused: plan.refused,
          note: await getNote(id),
          actions: await listActions(id),
        });
      }

      case 'weave': {
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const { weaveNote } = await import('$lib/daydream/notebook/cards');
        return json({ ok: true, weave: await weaveNote(id) });
      }

      default:
        return json({ error: `unknown action: ${action || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[notebook] action ${action} failed:`, errMsg(err));
    return json({ error: errMsg(err) }, { status: 400 });
  }
};
