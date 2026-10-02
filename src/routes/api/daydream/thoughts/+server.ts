// Owner-gated actions on the daydream ledger.
//
// NOT in PUBLIC_PATHS, and must never be: only `/api/daydream/observe` is
// listed there, as an exact path, precisely so this sibling stays behind the
// Auth.js gate. Everything here writes the owner's judgements: verdicts on
// think notes, his rulings on their claims, and the on/off switch. (The engine rooms' actions went with them,
// P4 of the 2026-09-25 simplification; the backlog's moved to
// `/api/jkai/backlog` with the board, 2026-09-26.)

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordFeedback, unmuteKind } from '$lib/daydream/thought-store';
import { errMsg } from '$lib/daydream/types';

/**
 * One endpoint, an `action` discriminator, because every one of these is the
 * same shape: the owner ruling on something the engine produced. Splitting them
 * across five routes would multiply the surface without adding a distinction.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'body must be JSON' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');

  try {
    switch (action) {
      case 'feedback': {
        const id = str('id');
        const verdict = str('verdict');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        if (verdict !== 'useful' && verdict !== 'not_useful' && verdict !== 'never_kind') {
          return json({ error: 'verdict must be useful, not_useful or never_kind' }, { status: 400 });
        }
        const res = await recordFeedback(id, verdict, str('note') || undefined);
        return json({ ok: true, ...res });
      }

      case 'add_note': {
        // Free text, because the closed feedback vocabulary carries a verdict
        // and never a reason, and the reason is the half worth having.
        const thoughtId = typeof body.thoughtId === 'string' ? body.thoughtId : '';
        const text = typeof body.text === 'string' ? body.text : '';
        if (!thoughtId) return json({ error: 'thoughtId is required' }, { status: 400 });
        if (!text.trim()) return json({ error: 'a note needs some words' }, { status: 400 });

        const { addNote } = await import('$lib/daydream/notes');
        try {
          const result = await addNote(thoughtId, text);
          return json({ ok: true, ...result });
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : 'could not save that note' },
            { status: 400 },
          );
        }
      }

      case 'owner_verdict': {
        // "This is wrong, because …" — or "it was right after all". A ruling
        // on the CLAIM, not the kind: feedback is untouched. His reason
        // becomes the lesson the think loop reads (`owner-verdict.ts`).
        const { parseOwnerVerdict, recordOwnerVerdict } = await import('$lib/daydream/owner-verdict');
        const parsed = parseOwnerVerdict(body);
        if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
        const result = await recordOwnerVerdict(parsed.thoughtId, parsed.verdict, parsed.why);
        return json({ ok: true, ...result });
      }

      case 'do_it':
      case 'undo_it':
      case 'send_it': {
        // "Do it for me": carry the note's step out now — the tap is the
        // consent (`act/act.server.ts`). Reversible, private kinds only.
        const thoughtId = str('thoughtId');
        if (!thoughtId) return json({ error: 'thoughtId is required' }, { status: 400 });
        const { doIt, undoIt, sendIt } = await import('$lib/daydream/act/act.server');
        // `send_it` is the guided kind's second tap: a draft he has read.
        const result = action === 'do_it' ? await doIt(thoughtId) : action === 'send_it' ? await sendIt(thoughtId) : await undoIt(thoughtId);
        // A refusal is an answer, not a fault: 200 with the reason to show.
        return json(result);
      }

      case 'act_calendar': {
        // The one-time choice of where "Do it for me" writes.
        const { chooseCalendar } = await import('$lib/daydream/act/act.server');
        const name = str('calendar');
        if (!name) return json({ error: 'calendar is required' }, { status: 400 });
        const result = await chooseCalendar(name);
        return json(result, { status: result.ok ? 200 : 400 });
      }

      case 'set_enabled': {
        // The kill switch, finally a control rather than a banner naming a
        // settings key. Boolean set explicitly both ways — setSetting(k, null)
        // cannot unset, and "unset means enabled" is the engine's convention.
        const { setSetting } = await import('$lib/server/models/settings');
        const { SETTINGS_ENABLED_KEY } = await import('$lib/daydream/types');
        const enabled = body.enabled === true;
        await setSetting(SETTINGS_ENABLED_KEY, enabled);
        return json({ ok: true, enabled });
      }

      case 'unmute_kind': {
        const kind = str('kind');
        if (!kind) return json({ error: 'kind is required' }, { status: 400 });
        // An absolute mute has to be reversible, or a mis-tap is permanent and
        // the only recourse is editing app_settings by hand.
        await unmuteKind(kind);
        return json({ ok: true });
      }

      default:
        return json({ error: `unknown action: ${action || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[daydream] action ${action} failed:`, errMsg(err));
    return json({ error: errMsg(err) }, { status: 400 });
  }
};
