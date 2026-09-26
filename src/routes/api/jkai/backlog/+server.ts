// Owner actions on the build backlog — `improvement_backlog` and its epics.
//
// Moved out of `/api/daydream/thoughts` on 2026-09-26 with the board itself:
// the backlog is the build process's intake (`intakeIdeas`), not something the
// daydream loop owns. /api/jkai inherits the owner gate in hooks.server.ts.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errMsg } from '$lib/selfimprove/types';

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
 * same shape: the owner ruling on a queued item. The action names are the ones
 * the board has always sent.
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
      // The queue board (2026-09-04).
      //
      // Owner edits on `improvement_backlog`, all keyed by slug. They exist
      // because the queue reached 455 rows with 280 of the 352 open ones tied
      // on priority 2: the engine could add to the pile and nothing could
      // sort, merge or close it.
      //
      // None of them spends anything directly. The owner's tap for a costly
      // lane is SAVING AN ACCEPTED BRIEF (`backlog_update` with `grooming`,
      // which stamps `grooming.acceptedAt`); the nightly propose phase then
      // dispatches at most one tapped build a night. A drag on a board must
      // never be what starts one.

      /**
       * Groom a draft with JKAI's configured default model. This is read-only:
       * the person still applies and saves the returned proposal explicitly.
       */
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
      case 'backlog_epic': {
        const slug = str('slug');
        if (!slug) return json({ error: 'slug is required' }, { status: 400 });
        const { setEpic } = await import('$lib/selfimprove/backlog');
        const next = await setEpic(slug, str('epicSlug') || null);
        return json({ ok: true, slug, epicSlug: next.epicSlug ?? null });
      }

      /**
       * Fold restatements of one idea into a single item.
       *
       * The losers are abandoned with a pointer, never deleted: `addIdeas`
       * checks existence BY KEY, so the surviving row is what stops the same
       * idea being written fresh tomorrow at `attempts: 0`.
       */
      case 'backlog_fold': {
        const slugs = Array.isArray(body.slugs)
          ? body.slugs.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
          : [];
        if (slugs.length < 2) {
          return json({ error: 'folding needs at least two items' }, { status: 400 });
        }
        const { foldItems } = await import('$lib/selfimprove/backlog');
        const res = await foldItems(slugs, str('into') || undefined);
        return json({ ok: true, ...res });
      }

      /**
       * Find the themes in the queue.
       *
       * On demand as well as nightly: it is pure CPU over rows already in
       * memory — 66ms for production's 455 — so making the owner wait until
       * tomorrow to see the duplicates would be a choice, not a constraint.
       */
      case 'backlog_cluster': {
        // The boot seeder creates `improvement_epics` on every start, but it is
        // fire-and-forget (`void runSeeds()` in engine.ts), so a press landing
        // in the first seconds after a deploy could write into a collection
        // that is not there yet — and `findThemes` logs that per-epic rather
        // than failing, which would look exactly like a button that worked and
        // found nothing. Idempotent, so this costs one lookup.
        const [{ findThemes }, { ensureSystemCollections }] = await Promise.all([
          import('$lib/selfimprove/epics'),
          import('$lib/selfimprove/seed-apis'),
        ]);
        await ensureSystemCollections();
        const res = await findThemes();
        return json({ ok: true, ...res, proposed: res.proposed.length });
      }

      /**
       * Rule on a theme.
       *
       * Accepting GROUPS its members; it never folds them. "About the same
       * subject" and "says the same thing" are two judgements, and only the
       * first is one a matcher may make — the second abandons rows, and the
       * owner makes it per item inside the lane.
       */
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

      case 'epic_decide': {
        const slug = str('slug');
        const decision = str('decision');
        if (!slug) return json({ error: 'slug is required' }, { status: 400 });
        const { decideEpic, ungroupEpic } = await import('$lib/selfimprove/epics');
        if (decision === 'ungroup') {
          const res = await ungroupEpic(slug);
          return json(res.failed.length ? { ok: false, ...res, error: res.failed[0].error } : { ok: true, ...res });
        }
        if (decision !== 'accept' && decision !== 'decline') {
          return json({ error: 'decision must be accept, decline or ungroup' }, { status: 400 });
        }
        const res = await decideEpic(slug, decision);
        return json(res.failed.length ? { ok: false, ...res, error: res.failed[0].error } : { ok: true, ...res });
      }

      default:
        return json({ error: `unknown action: ${action || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[backlog] action ${action} failed:`, errMsg(err));
    return json({ error: errMsg(err) }, { status: 400 });
  }
};
