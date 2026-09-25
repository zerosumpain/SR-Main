// Owner-gated actions on the daydream ledger.
//
// NOT in PUBLIC_PATHS, and must never be: everything here reads or writes the
// owner's judgements. Since P4a (2026-09-25) it carries only the actions a
// kept page or component actually POSTs — the feed's verdicts and notes, the
// context panel's snooze/archive, the evidence drill, memory consolidation and
// the backlog room. The other 39 went with the engine they drove.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordFeedback, snoozeThought, unmuteKind } from '$lib/daydream/thought-store';
import { errMsg } from '$lib/daydream/types';

/**
 * Shape a bulk result the way `postThought` reads failure.
 *
 * That client treats a response as successful unless the HTTP status is bad OR
 * the body carries a top-level `error`. A per-slug `failed[]` alone is
 * therefore INVISIBLE to the caller: a park refused because the item had
 * already shipped would have looked, on screen, exactly like a park that
 * worked. So a partial result reports the count and the first reason, and the
 * detail rides alongside for anyone reading the response.
 */
function bulkBody(res: { changed: string[]; failed: Array<{ slug: string; error: string }> }) {
  if (res.failed.length === 0) return { ok: true, ...res };
  const [first] = res.failed;
  const more = res.failed.length - 1;
  return {
    ok: false,
    ...res,
    error:
      res.failed.length === 1
        ? first.error
        : `${first.error} (and ${more} other${more === 1 ? '' : 's'})`,
  };
}

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
  /** One key that may be an array, falling back to a single-value key. */
  const strList = (many: string, one: string): string[] => {
    const raw = Array.isArray(body[many]) ? (body[many] as unknown[]) : [];
    const list = raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim());
    const single = str(one);
    return [...new Set([...list, ...(single ? [single] : [])].filter(Boolean))];
  };

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

      case 'snooze': {
        const id = str('id');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const days = Number(body.days);
        await snoozeThought(id, Number.isFinite(days) && days > 0 ? days : 7);
        return json({ ok: true });
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

      case 'archive': {
        const id = str('id');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const { archiveThought } = await import('$lib/daydream/thought-store');
        return json({ ok: true, ...(await archiveThought(id)) });
      }

      // ── Queue to model ────────────────────────────────────────────────
      //
      // The reviewer already runs on a heartbeat over what is pending. This is
      // the same pass, asked for by hand, on ANY card — including a suppressed
      // one the automatic sweep would never reach, because it only walks
      // `new`/`suppressed` rows that are still unreviewed. Re-ruling a card
      // that already has a verdict is the point: he is asking it to go and
      // look again.
      //
      // The ruling is then written to `jkai_memories`, which is what makes it
      // stick. The reviewer itself does not do that — see rulings.ts for why
      // the caller composes the memory and the model never holds the pen.
      case 'consolidate_memories': {
        const { budgetStatus } = await import('$lib/daydream/budget');
        const { resolveDaydreamModel } = await import('$lib/daydream/model');
        const model = await resolveDaydreamModel();
        const budget = await budgetStatus({ now: new Date(), isCodexModel: model.provider === 'codex' });
        if (budget.blocked) return json({ error: `budget: ${budget.blockedReason}` }, { status: 429 });
        const { runMemoryConsolidation } = await import('$lib/daydream/memory-consolidation.server');

        // A production-sized model pass can outlive Cloudflare's 100-second
        // request limit. Wait only until the run row has been claimed, then let
        // the work continue while the Memory tab polls that durable status.
        // This also means a gateway timeout can no longer make successful work
        // look like a failure in the browser.
        type Started = { localDay: string; startedAt: Date };
        let markStarted: (started: Started) => void = () => undefined;
        const started = new Promise<Started>((resolve) => { markStarted = resolve; });
        const work = runMemoryConsolidation({ allowRepeat: true, onStarted: markStarted });
        const first = await Promise.race([
          started.then((value) => ({ kind: 'started' as const, value })),
          work.then((result) => ({ kind: 'finished' as const, result })),
        ]);

        if (first.kind === 'finished') {
          if (first.result.status === 'failed') {
            return json({ error: first.result.error, result: first.result }, { status: 502 });
          }
          if (first.result.status === 'already_running') {
            return json({ ok: true, accepted: true, localDay: first.result.localDay, alreadyRunning: true }, { status: 202 });
          }
          return json({ ok: true, result: first.result });
        }

        void work
          .then((result) => {
            if (result.status === 'failed') {
              console.error('[daydream] background memory consolidation failed:', result.error);
            }
          })
          .catch((err) => {
            console.error('[daydream] background memory consolidation crashed:', errMsg(err));
          });

        return json({
          ok: true,
          accepted: true,
          localDay: first.value.localDay,
          startedAt: first.value.startedAt.toISOString(),
        }, { status: 202 });
      }

      // ── How a line of enquiry is going ────────────────────────────────
      //
      // The trace `run.ts` has always written and nothing ever read. Fetched on
      // demand: a lead can carry two hundred steps, and the Discoveries tab
      // already loads the heaviest query on the hub.
      case 'backlog_groom': {
        const title = str('title');
        const detail = str('detail');
        const message = str('message');
        if (!title && !detail && !message) {
          return json({ error: 'add a title, brief or question before grooming' }, { status: 400 });
        }
        const { groomBacklogDraft } = await import('$lib/selfimprove/grooming.server');
        try {
          const result = await groomBacklogDraft({
            slug: str('slug') || null,
            title,
            detail,
            kind: str('kind'),
            priority: Number(body.priority),
            grooming: body.grooming,
            conversation: body.conversation,
            message,
          });
          return json({ ok: true, ...result });
        } catch (err) {
          return json({ error: errMsg(err) }, { status: 502 });
        }
      }

      /** Add an owner-authored feature directly to the accepted queue. */
      case 'backlog_create': {
        const title = str('title');
        if (!title) return json({ error: 'title is required' }, { status: 400 });
        const priority = Number(body.priority);
        if (!Number.isFinite(priority)) {
          return json({ error: 'priority must be a number 1-5' }, { status: 400 });
        }
        const epicSlug = str('epicSlug');
        if (epicSlug) {
          const { loadEpicBacklog } = await import('$lib/selfimprove/epic-backlog.server');
          if (!(await loadEpicBacklog()).some((e) => e.slug === epicSlug)) return json({ error: 'Epic not found' }, { status: 404 });
        }
        const { createBacklogItem } = await import('$lib/selfimprove/backlog');
        const item = await createBacklogItem({
          title,
          ...(epicSlug ? { epicSlug } : {}),
          detail: str('detail'),
          kind: str('kind'),
          priority,
          ...(body.grooming ? { grooming: body.grooming } : {}),
        });
        return json({ ok: true, slug: item.slug });
      }

      /** Edit the owner-controlled fields while retaining build history. */
      case 'backlog_update': {
        const slug = str('slug');
        const title = str('title');
        if (!slug) return json({ error: 'slug is required' }, { status: 400 });
        if (!title) return json({ error: 'title is required' }, { status: 400 });
        const priority = Number(body.priority);
        if (!Number.isFinite(priority)) {
          return json({ error: 'priority must be a number 1-5' }, { status: 400 });
        }
        const { updateBacklogItem } = await import('$lib/selfimprove/backlog');
        const item = await updateBacklogItem(slug, {
          title,
          detail: str('detail'),
          kind: str('kind'),
          priority,
          ...(body.grooming ? { grooming: body.grooming } : {}),
        });
        return json({ ok: true, slug: item.slug });
      }

      /**
       * Leave a note on one item.
       *
       * The author is stamped HERE as `owner` and never read out of the body,
       * the same rule `coerceSource` follows for intake: a request must not be
       * able to sign its content as the model when a person typed it.
       */
      case 'backlog_note': {
        const slug = str('slug');
        const text = str('text');
        if (!slug) return json({ error: 'slug is required' }, { status: 400 });
        if (!text) return json({ error: 'a note needs some text' }, { status: 400 });
        const { addBacklogNote } = await import('$lib/selfimprove/backlog');
        const item = await addBacklogNote(slug, text, 'owner');
        return json({ ok: true, slug, notes: item.notes ?? [] });
      }

      /**
       * Read the thread on one item.
       *
       * Notes are NOT on the board payload. The board already ships 414 KB for
       * 455 items, and note bodies have no per-item bound the way every other
       * field does — one item with a long argument on it would be carried by
       * every page load of the room. They are fetched when the panel that
       * shows them opens.
       */
      case 'backlog_notes': {
        const slug = str('slug');
        if (!slug) return json({ error: 'slug is required' }, { status: 400 });
        const { getBacklogItem } = await import('$lib/selfimprove/backlog');
        const item = await getBacklogItem(slug);
        if (!item) return json({ error: `no backlog item “${slug}”` }, { status: 404 });
        return json({ ok: true, slug, notes: item.notes ?? [] });
      }

      /** Delete one note. Nothing else on the item moves. */
      case 'backlog_note_remove': {
        const slug = str('slug');
        const id = str('id');
        if (!slug) return json({ error: 'slug is required' }, { status: 400 });
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const { removeBacklogNote } = await import('$lib/selfimprove/backlog');
        const item = await removeBacklogNote(slug, id);
        return json({ ok: true, slug, notes: item.notes ?? [] });
      }

      /**
       * Remove a feature from the board. The datastore row becomes a hidden
       * tombstone instead of being hard-deleted, so the proposal engine cannot
       * recreate it tomorrow with its attempt history erased.
       */
      case 'backlog_remove': {
        const slug = str('slug');
        if (!slug) return json({ error: 'slug is required' }, { status: 400 });
        const { removeBacklogItem } = await import('$lib/selfimprove/backlog');
        await removeBacklogItem(slug);
        return json({ ok: true, slug });
      }

      /**
       * Reprioritise. `pickWork` ranks on this, so it changes tonight's work.
       *
       * Takes `slug` OR `slugs` — the board's bulk button acts on a selection,
       * and N requests meant N full page reloads, each re-paging the datastore
       * and re-running the already-served sweep.
       */
      case 'backlog_priority': {
        const slugs = strList('slugs', 'slug');
        const priority = Number(body.priority);
        if (slugs.length === 0) return json({ error: 'slug or slugs is required' }, { status: 400 });
        if (!Number.isFinite(priority)) {
          return json({ error: 'priority must be a number 1-5' }, { status: 400 });
        }
        const { setPriorityMany } = await import('$lib/selfimprove/backlog');
        return json(bulkBody(await setPriorityMany(slugs, priority)));
      }

      /** Park items, or put parked ones back in the running. */
      case 'backlog_park': {
        const slugs = strList('slugs', 'slug');
        if (slugs.length === 0) return json({ error: 'slug or slugs is required' }, { status: 400 });
        // Explicit, not inferred from presence: `{parked: false}` is a
        // re-open and `{}` must not silently mean one.
        if (typeof body.parked !== 'boolean') {
          return json({ error: 'parked must be true or false' }, { status: 400 });
        }
        const { setParkedMany } = await import('$lib/selfimprove/backlog');
        return json(bulkBody(await setParkedMany(slugs, body.parked, str('reason') || undefined)));
      }

      /** Group an item into a board swimlane, or clear it. */
      case 'backlog_grooming_override': {
        if (typeof body.keepSeparate !== 'boolean' || !str('itemId')) return json({ error: 'itemId and keepSeparate are required' }, { status: 400 });
        const { setGroomingOverride } = await import('$lib/workflows/backlog-grooming.server');
        await setGroomingOverride(str('itemId'), body.keepSeparate);
        return json({ ok: true });
      }

      /**
       * Rule on one suggestion, or on a batch of them.
       *
       * `ids` exists because the review lane offers "apply every merge", and a
       * hundred single requests is a hundred board rebuilds. One request takes
       * the grooming lock once; a suggestion invalidated by an earlier decision
       * in the same batch comes back in `failed` rather than being forced.
       */
      case 'backlog_grooming_decide': {
        const decision = str('decision');
        if (decision !== 'apply' && decision !== 'keep') return json({ error: 'decision must be apply or keep' }, { status: 400 });
        const ids = strList('ids', 'id');
        if (ids.length === 0) return json({ error: 'id or ids is required' }, { status: 400 });
        const { decideBacklogGroomingMany } = await import('$lib/workflows/backlog-grooming.server');
        const res = await decideBacklogGroomingMany(ids, decision);
        if (res.failed.length === 0) return json({ ok: true, ...res });
        const [first] = res.failed;
        const more = res.failed.length - 1;
        return json({
          ok: false,
          ...res,
          error: more === 0 ? first.error : `${first.error} (and ${more} other${more === 1 ? '' : 's'})`,
        });
      }

      case 'epic_update': {
        const { updateEpic } = await import('$lib/selfimprove/epic-backlog.server');
        await updateEpic(str('slug'), str('title'), str('summary'), body.priority == null ? undefined : Number(body.priority));
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
