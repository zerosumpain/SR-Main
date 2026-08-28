// Owner-gated actions on the daydream ledger.
//
// NOT in PUBLIC_PATHS, and must never be: only `/api/daydream/observe` is
// listed there, as an exact path, precisely so this sibling stays behind the
// Auth.js gate. Everything here reads or writes the owner's movements and
// judgements.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadLedger, snoozeThought, unmuteKind } from '$lib/daydream/ledger';
import { loadTriageDeck, recordFeedback, recordTriageBatch } from '$lib/daydream/thought-store';
import {
  confirmPlace,
  describePlaceRhythm,
  ignorePlace,
  isPlaceKind,
  listNamingQueue,
} from '$lib/daydream/places';
import { errMsg } from '$lib/daydream/types';
import { loadBoard, rateQuestion } from '$lib/daydream/hypotheses/store';
import { addSteer, listSteers, setSteerStatus } from '$lib/daydream/hypotheses/steer';

export const GET: RequestHandler = async () => {
  try {
    return json(await loadLedger());
  } catch (err) {
    console.error('[daydream] ledger read failed:', errMsg(err));
    return json({ error: errMsg(err) }, { status: 500 });
  }
};

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

      case 'snooze': {
        const id = str('id');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const days = Number(body.days);
        await snoozeThought(id, Number.isFinite(days) && days > 0 ? days : 7);
        return json({ ok: true });
      }

      case 'family_now': {
        // Positions for the Family map, fetched on demand rather than riding
        // in the page payload — the ledger's standing rule is that a lat/lon
        // never leaves in bulk; this is one owner-gated read for one render,
        // the same shape the place-naming map uses.
        const { db } = await import('$lib/db');
        const { daydreamTrail } = await import('$lib/db/schema');
        const { FAMILY_SUBJECTS } = await import('$lib/daydream/types');
        const { and, desc, eq, isNotNull } = await import('drizzle-orm');
        const positions: Array<{ subject: string; lat: number; lon: number; isHome: boolean | null; ageMins: number }> = [];
        for (const f of FAMILY_SUBJECTS) {
          const [row] = await db
            .select({ ts: daydreamTrail.ts, lat: daydreamTrail.lat, lon: daydreamTrail.lon, isHome: daydreamTrail.isHome })
            .from(daydreamTrail)
            .where(and(eq(daydreamTrail.subject, f.subject), isNotNull(daydreamTrail.lat)))
            .orderBy(desc(daydreamTrail.ts))
            .limit(1);
          if (row?.lat != null && row.lon != null) {
            positions.push({
              subject: f.subject,
              lat: row.lat,
              lon: row.lon,
              isHome: row.isHome,
              ageMins: Math.max(0, Math.round((Date.now() - row.ts.getTime()) / 60_000)),
            });
          }
        }
        return json({ positions });
      }

      case 'thought_map': {
        // A place question without a map is a memory test. Coordinates are
        // fetched here, one owner-gated read for one render, rather than riding
        // in the ledger payload — the standing rule this feature has kept since
        // merge 3, and the same shape `family_now` and the naming card use.
        const thoughtId = typeof body.thoughtId === 'string' ? body.thoughtId : '';
        if (!thoughtId) return json({ error: 'thoughtId is required' }, { status: 400 });

        const { db } = await import('$lib/db');
        const { daydreamPlaces, daydreamThoughts } = await import('$lib/db/schema');
        const { eq } = await import('drizzle-orm');

        const [row] = await db
          .select({
            lat: daydreamPlaces.lat,
            lon: daydreamPlaces.lon,
            radiusM: daydreamPlaces.radiusM,
            label: daydreamPlaces.label,
            suggestedLabel: daydreamPlaces.suggestedLabel,
            suggestedAddress: daydreamPlaces.suggestedAddress,
          })
          .from(daydreamThoughts)
          .innerJoin(daydreamPlaces, eq(daydreamPlaces.id, daydreamThoughts.placeId))
          .where(eq(daydreamThoughts.id, thoughtId))
          .limit(1);

        // Not every thought is about somewhere. A thought with no place is a
        // normal answer, not an error.
        if (!row) return json({ place: null });
        return json({ place: row });
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

      case 'run_action': {
        // One-tap execution of an action a musing proposed. The stored action
        // re-validates through the closed vocabulary before anything runs, so
        // the execute path can never do what the propose path would refuse.
        // Acting on a thought is the strongest engagement signal there is, so
        // it also records an inferred `useful` — the same noticing-without-
        // pretending shape confirmPlace uses.
        const id = str('id');
        const index = Number(body.index);
        if (!id || !Number.isFinite(index)) {
          return json({ error: 'id and index are required' }, { status: 400 });
        }
        const { db } = await import('$lib/db');
        const { daydreamThoughts } = await import('$lib/db/schema');
        const { eq } = await import('drizzle-orm');
        const [thought] = await db
          .select({
            id: daydreamThoughts.id,
            feedback: daydreamThoughts.feedback,
            proposedActions: daydreamThoughts.proposedActions,
          })
          .from(daydreamThoughts)
          .where(eq(daydreamThoughts.id, id))
          .limit(1);
        if (!thought) return json({ error: 'no such thought' }, { status: 404 });
        const actions = (thought.proposedActions ?? []) as Array<{ kind: string; label: string; payload: string }>;
        const proposed = actions[index];
        if (!proposed) return json({ error: 'no such action on this thought' }, { status: 400 });
        const { fromProposedAction, executeAction } = await import('$lib/daydream/actions');
        const v = fromProposedAction(proposed);
        if ('error' in v) return json({ error: `action invalid: ${v.error}` }, { status: 400 });
        const run = await executeAction(v.action, { key: `tap:${id}:${index}` });
        if (!run.ok) return json({ error: run.detail }, { status: 500 });
        await db
          .update(daydreamThoughts)
          .set({
            status: 'actioned',
            ...(thought.feedback
              ? {}
              : { feedback: 'useful', feedbackSource: 'action', feedbackAt: new Date() }),
            updatedAt: new Date(),
          })
          .where(eq(daydreamThoughts.id, id));
        return json({ ok: true, detail: run.detail });
      }

      case 'unmute_kind': {
        const kind = str('kind');
        if (!kind) return json({ error: 'kind is required' }, { status: 400 });
        // An absolute mute has to be reversible, or a mis-tap is permanent and
        // the only recourse is editing app_settings by hand.
        await unmuteKind(kind);
        return json({ ok: true });
      }

      case 'decide_rule': {
        const ruleId = str('ruleId');
        const decision = str('decision');
        if (!ruleId) return json({ error: 'ruleId is required' }, { status: 400 });
        if (decision !== 'approve' && decision !== 'reject' && decision !== 'deprecate') {
          return json({ error: 'decision must be approve, reject or deprecate' }, { status: 400 });
        }
        const { decideRule } = await import('$lib/daydream/rules/store');
        return json({ ok: true, ...(await decideRule(ruleId, decision)) });
      }

      case 'suggest_name': {
        // Reverse-geocode the place's own centre. The caller passes an id, not
        // coordinates — the client should never be the source of truth for
        // where a place is, and passing lat/lon in would let any caller
        // geocode arbitrary points through an owner-gated route.
        const placeId = str('placeId');
        if (!placeId) return json({ error: 'placeId is required' }, { status: 400 });
        const { db } = await import('$lib/db');
        const { daydreamPlaces } = await import('$lib/db/schema');
        const { eq } = await import('drizzle-orm');
        const [place] = await db
          .select({ lat: daydreamPlaces.lat, lon: daydreamPlaces.lon })
          .from(daydreamPlaces)
          .where(eq(daydreamPlaces.id, placeId))
          .limit(1);
        if (!place) return json({ error: 'no such place' }, { status: 404 });
        const { suggestPlaceName } = await import('$lib/daydream/geocode');
        const { getPlaceVisits } = await import('$lib/daydream/places');
        // Both in one round trip: the naming form wants them together, and two
        // requests for one panel is two chances to half-render.
        const [suggestion, visits] = await Promise.all([
          suggestPlaceName(place.lat, place.lon),
          getPlaceVisits(placeId),
        ]);
        return json({ ok: true, suggestion, visits });
      }

      case 'name_place': {
        const placeId = str('placeId');
        const label = str('label');
        const kind = str('kind') || 'other';
        if (!placeId) return json({ error: 'placeId is required' }, { status: 400 });
        if (!label) return json({ error: 'a place needs a name' }, { status: 400 });
        if (!isPlaceKind(kind)) {
          return json({ error: `unknown place kind: ${kind}` }, { status: 400 });
        }
        const res = await confirmPlace(placeId, label, kind);
        return json({ ok: true, ...res });
      }

      // The sit-down session. One request returns the whole queue with its
      // suggestions already attached, because the alternative — a lookup per
      // card as the owner reaches it — puts a third party's latency and rate
      // limit in the middle of a form the owner is trying to get through.
      // `daydream-suggest` has already paid that cost in the background.
      case 'naming_queue': {
        const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 200);
        const places = await listNamingQueue(limit);
        return json({
          ok: true,
          places: places.map((p) => ({
            id: p.id,
            visitCount: p.visitCount,
            medianDwellMins: p.medianDwellMins,
            rhythm: describePlaceRhythm(p),
            lastSeenAt: p.lastSeenAt,
            suggestedLabel: p.suggestedLabel,
            suggestedKind: p.suggestedKind,
            suggestedAddress: p.suggestedAddress,
            // Coordinates deliberately omitted. The naming form needs to say
            // WHERE, and the street address does that without putting a precise
            // fix of the owner's home into a JSON payload the browser caches.
          })),
        });
      }

      // Naming several places in one go. The session is the point: thirty
      // places in ten minutes costs no interruption budget, where the same
      // thirty as notifications would take a week at MAX_PER_DAY.
      case 'name_places': {
        const items = Array.isArray(body.places) ? body.places : null;
        if (!items || items.length === 0) {
          return json({ error: 'places must be a non-empty array' }, { status: 400 });
        }
        if (items.length > 100) {
          return json({ error: 'at most 100 places at a time' }, { status: 400 });
        }

        const named: string[] = [];
        const failed: { placeId: string; error: string }[] = [];
        let thoughtsResolved = 0;

        // Sequential, and each failure is collected rather than thrown. One bad
        // row in a batch of thirty must not discard the twenty-nine answers the
        // owner already typed — losing those is losing the session.
        for (const raw of items) {
          const item = (raw ?? {}) as Record<string, unknown>;
          const placeId = typeof item.placeId === 'string' ? item.placeId.trim() : '';
          const label = typeof item.label === 'string' ? item.label.trim() : '';
          const kind = typeof item.kind === 'string' ? item.kind.trim() : 'other';
          if (!placeId) {
            failed.push({ placeId: '(missing)', error: 'placeId is required' });
            continue;
          }
          if (!label) {
            failed.push({ placeId, error: 'a place needs a name' });
            continue;
          }
          if (!isPlaceKind(kind)) {
            failed.push({ placeId, error: `unknown place kind: ${kind}` });
            continue;
          }
          try {
            const res = await confirmPlace(placeId, label, kind);
            thoughtsResolved += res.thoughtsResolved;
            named.push(placeId);
          } catch (err) {
            failed.push({ placeId, error: errMsg(err) });
          }
        }

        return json({ ok: true, named: named.length, failed, thoughtsResolved });
      }

      // The sorting deck. Suppressed candidates, ordered by how often they
      // have been re-proposed and never said.
      case 'triage_deck': {
        const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 100);
        return json({ ok: true, deck: await loadTriageDeck(limit) });
      }

      case 'triage_batch': {
        const raw = Array.isArray(body.verdicts) ? body.verdicts : null;
        if (!raw || raw.length === 0) {
          return json({ error: 'verdicts must be a non-empty array' }, { status: 400 });
        }
        if (raw.length > 100) {
          return json({ error: 'at most 100 verdicts at a time' }, { status: 400 });
        }
        const allowed = new Set(['useful', 'not_useful', 'never_kind']);
        const items: Array<{ id: string; verdict: 'useful' | 'not_useful' | 'never_kind' }> = [];
        for (const r of raw) {
          const it = (r ?? {}) as Record<string, unknown>;
          const id = typeof it.id === 'string' ? it.id.trim() : '';
          const verdict = typeof it.verdict === 'string' ? it.verdict : '';
          if (!id || !allowed.has(verdict)) continue;
          items.push({ id, verdict: verdict as 'useful' | 'not_useful' | 'never_kind' });
        }
        if (items.length === 0) {
          return json({ error: 'no usable verdicts in the batch' }, { status: 400 });
        }
        return json({ ok: true, ...(await recordTriageBatch(items)) });
      }

      // The propositions board: everything asked, whatever the answer was.
      case 'hypothesis_board': {
        const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 200);
        return json({ ok: true, board: await loadBoard(limit) });
      }

      // Rating the QUESTION, not the statistics. He cannot overrule a q-value
      // and should not be asked to; the signal is whether asking was worth it.
      case 'rate_question': {
        const id = str('id');
        const verdict = str('verdict');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        if (verdict !== 'useful' && verdict !== 'not_useful') {
          return json({ error: `unknown verdict: ${verdict || '(none)'}` }, { status: 400 });
        }
        await rateQuestion(id, verdict);
        return json({ ok: true });
      }

      // Steering. Reorders what gets asked; grants no new access whatsoever.
      case 'add_steer': {
        const text = str('text');
        if (!text) return json({ error: 'a steer needs some text' }, { status: 400 });
        const id = await addSteer(text);
        return json({ ok: true, id, steers: await listSteers() });
      }

      case 'list_steers': {
        return json({ ok: true, steers: await listSteers() });
      }

      case 'set_steer_status': {
        const id = str('id');
        const status = str('status');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        if (status !== 'active' && status !== 'done' && status !== 'dropped') {
          return json({ error: `unknown status: ${status || '(none)'}` }, { status: 400 });
        }
        await setSteerStatus(id, status);
        return json({ ok: true, steers: await listSteers() });
      }

      case 'ignore_place': {
        const placeId = str('placeId');
        if (!placeId) return json({ error: 'placeId is required' }, { status: 400 });
        await ignorePlace(placeId);
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
