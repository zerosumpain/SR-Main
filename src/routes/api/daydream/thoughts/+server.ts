// Owner-gated actions on the daydream ledger.
//
// NOT in PUBLIC_PATHS, and must never be: only `/api/daydream/observe` is
// listed there, as an exact path, precisely so this sibling stays behind the
// Auth.js gate. Everything here reads or writes the owner's movements and
// judgements.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { snoozeThought, unmuteKind } from '$lib/daydream/ledger';
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

      case 'hypothesis_detail': {
        // Click-through from a verdict to the days it was computed from. The
        // board could say "r = -0.12 over 58 days" with no way to see which 58
        // — a verdict you cannot open is one you have to take on trust.
        const id = str('id');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const { loadHypothesisDetail } = await import('$lib/daydream/hypotheses/detail');
        const detail = await loadHypothesisDetail(id);
        if (!detail) return json({ error: 'no such question' }, { status: 404 });
        return json({ detail });
      }

      case 'evidence': {
        // Drill-through. A thought's citations were rendered as `kind` + a
        // uuid, which is a receipt rather than an explanation — "why did it
        // say that?" could only be answered by opening a database. Resolved on
        // demand rather than in the ledger loader: most cards are never
        // expanded, and this is up to nine queries.
        const id = str('id');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const { db } = await import('$lib/db');
        const { daydreamThoughts } = await import('$lib/db/schema');
        const { eq } = await import('drizzle-orm');
        const [row] = await db
          .select({ evidence: daydreamThoughts.evidence })
          .from(daydreamThoughts)
          .where(eq(daydreamThoughts.id, id))
          .limit(1);
        if (!row) return json({ error: 'no such thought' }, { status: 404 });
        const { resolveEvidence } = await import('$lib/daydream/evidence');
        return json({ evidence: await resolveEvidence(row.evidence ?? []) });
      }

      // ── The diary filter ────────────────────────────────────────────────
      // Reading the calendar is a live CalDAV round trip, so it is an ACTION
      // and never part of the page load — the ledger loader is deliberately
      // free of them, and a month grid on every page view would put one back.
      case 'calendar_window': {
        const from = str('from');
        const to = str('to');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          return json({ error: 'from and to must be YYYY-MM-DD' }, { status: 400 });
        }
        const { readCalendar } = await import('$lib/daydream/calendar/read');
        const { loadExclusionSet, listExclusions } = await import('$lib/daydream/calendar/store');
        const { eventKeys } = await import('$lib/daydream/calendar/exclusions');
        const read = await readCalendar({ dateRangeStart: from, dateRangeEnd: to }, await loadExclusionSet());
        const rules = await listExclusions();

        // Note-only rules do not hide, so their events come back in the
        // visible half — but the panel still has to show what was said about
        // them, or the note looks like it was never saved.
        const notesByKey = new Map(
          rules.filter((r) => !r.hidden && r.reason).map((r) => [r.matchKey, r]),
        );
        const noteFor = (e: { uid: string | null; title: string; start: string }) => {
          for (const k of eventKeys(e)) {
            const hit = notesByKey.get(k);
            if (hit) return { noteId: hit.id, note: hit.reason, noteScope: hit.scope };
          }
          return { noteId: null, note: null, noteScope: null };
        };

        return json({
          // Both halves, flagged — the tab shows what is hidden alongside what
          // is not, because a filter you cannot see is a filter you cannot
          // revise.
          events: [
            ...read.events.map((e) => ({ ...e, excluded: false, hiddenBy: null as string | null, ...noteFor(e) })),
            ...read.hidden.map((e) => ({ ...e, excluded: true, noteId: null, note: null, noteScope: null })),
          ].sort((a, b) => a.start.localeCompare(b.start)),
          exclusions: rules,
          truncated: read.truncated,
          partial: read.partial,
          available: read.available,
          error: read.error,
        });
      }

      case 'exclude_event': {
        const scope = str('scope');
        if (scope !== 'series' && scope !== 'occurrence' && scope !== 'title') {
          return json({ error: 'scope must be series, occurrence or title' }, { status: 400 });
        }
        // `hidden: false` records what an entry MEANS without removing it —
        // "PE days are a reminder to take PE kit in, not a time commitment".
        // Hiding it would have hidden the kit reminder too.
        const hidden = body.hidden !== false;
        if (!hidden && !str('reason')) {
          return json({ error: 'a note needs some words' }, { status: 400 });
        }
        const { addExclusion } = await import('$lib/daydream/calendar/store');
        const res = await addExclusion({
          scope,
          hidden,
          uid: str('uid') || null,
          occurrenceStart: str('occurrenceStart') || null,
          title: str('title') || null,
          calendarName: str('calendarName') || null,
          reason: str('reason') || null,
        });
        if (!res.ok) return json({ error: res.error }, { status: 400 });
        return json({ ok: true, id: res.id, matchKey: res.matchKey });
      }

      case 'restore_event': {
        const id = str('id');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const { removeExclusion } = await import('$lib/daydream/calendar/store');
        return json({ ok: await removeExclusion(id) });
      }

      case 'set_bank_enabled': {
        // Arming the rails was an SQL statement against app_settings, which is
        // why it stayed off for a fortnight after the job shipped. Same
        // explicit-both-ways rule as the kill switch above: `unset` means OFF
        // here (the inverse of the master switch), and setSetting(k, null)
        // cannot express it.
        const { setSetting } = await import('$lib/server/models/settings');
        const { BANK_ENABLED_KEY } = await import('$lib/heartbeat/activities/daydream-bank');
        const enabled = body.enabled === true;
        await setSetting(BANK_ENABLED_KEY, enabled);

        // Arming it should not mean waiting until tomorrow's window to find
        // out whether the token still works. Due it now; the engine re-reads
        // next_run_at every 30s tick, and the action's own active-hours gate
        // still applies, so this asks rather than forces.
        if (enabled) {
          const { db } = await import('$lib/db');
          const { heartbeatActions } = await import('$lib/db/schema');
          const { eq } = await import('drizzle-orm');
          await db
            .update(heartbeatActions)
            .set({ nextRunAt: new Date() })
            .where(eq(heartbeatActions.name, 'daydream-bank'));
        }
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

      case 'activity_detail': {
        // One instrument, opened: the row, the handler, the mechanics and the
        // last ten pulses. On demand, so the room's arrival stays light.
        const name = str('name');
        if (!name) return json({ error: 'name is required' }, { status: 400 });
        const { loadActivityDetail } = await import('$lib/daydream/rooms/engine.server');
        return json({ detail: await loadActivityDetail(name) });
      }

      case 'effort': {
        const { loadEffort } = await import('$lib/daydream/effort.server');
        const { describeEffort, resolveEffort } = await import('$lib/daydream/effort');
        const effort = await loadEffort();
        return json({ effort, resolved: resolveEffort(effort), lines: describeEffort(effort) });
      }

      case 'set_effort': {
        // Three shares, 0..100. Spend stays under the Codex caps; the dial
        // decides what the allowance is spent on.
        const { setEffort } = await import('$lib/daydream/effort.server');
        const { describeEffort, resolveEffort } = await import('$lib/daydream/effort');
        const raw = (body.effort ?? {}) as Record<string, unknown>;
        const num = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : undefined);
        const effort = await setEffort({ discover: num('discover'), test: num('test'), propose: num('propose') });
        return json({ ok: true, effort, resolved: resolveEffort(effort), lines: describeEffort(effort) });
      }

      case 'routes': {
        const { loadRoutes } = await import('$lib/daydream/routes.server');
        return json({ routes: await loadRoutes() });
      }

      case 'set_route': {
        // Where a family or kind may go: whatsapp | briefing | feed, or null
        // to fall back to the default. A route is a ceiling, never a promise.
        const key = str('key');
        const route = body.route == null ? null : str('route');
        if (!key) return json({ error: 'key is required' }, { status: 400 });
        const { setRoute } = await import('$lib/daydream/routes.server');
        const { isRoute } = await import('$lib/daydream/routes');
        if (route != null && !isRoute(route)) return json({ error: `unknown route: ${route}` }, { status: 400 });
        return json({ ok: true, routes: await setRoute(key, route) });
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
        // null = every person; the board is household-wide.
        return json({ ok: true, board: await loadBoard(limit, null) });
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
        // A steer is a notebook note tagged `steer` now (2026-09-03).
        const text = str('text');
        if (!text) return json({ error: 'text is required' }, { status: 400 });
        const { addSteerNote } = await import('$lib/daydream/hypotheses/steer');
        return json({ ok: true, steers: await addSteerNote(text) });
      }

      case 'list_steers': {
        const { listSteerNotes } = await import('$lib/daydream/hypotheses/steer');
        return json({ steers: await listSteerNotes() });
      }

      case 'set_steer_status': {
        const id = str('id');
        const status = str('status');
        if (!id || !['active', 'done', 'dropped'].includes(status)) return json({ error: 'id and a status are required' }, { status: 400 });
        const { setSteerNoteStatus } = await import('$lib/daydream/hypotheses/steer');
        return json({ ok: true, steers: await setSteerNoteStatus(id, status as 'active' | 'done' | 'dropped') });
      }

      case 'ignore_place': {
        const placeId = str('placeId');
        if (!placeId) return json({ error: 'placeId is required' }, { status: 400 });
        await ignorePlace(placeId);
        return json({ ok: true });
      }

      // ── The third answer ──────────────────────────────────────────────
      //
      // Neither useful nor not useful — seen, and filed. Writes no feedback,
      // so it moves no kind weight and counts toward no threshold. See
      // `archiveThought` for why it cannot reuse `dismissed`.
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
      case 'review_now': {
        const id = str('id');
        if (!id) return json({ error: 'id is required' }, { status: 400 });

        const { db } = await import('$lib/db');
        const { daydreamThoughts } = await import('$lib/db/schema');
        const { eq } = await import('drizzle-orm');
        const [row] = await db
          .select({
            id: daydreamThoughts.id,
            kind: daydreamThoughts.kind,
            title: daydreamThoughts.title,
            explanation: daydreamThoughts.explanation,
            narrative: daydreamThoughts.narrative,
            evidence: daydreamThoughts.evidence,
          })
          .from(daydreamThoughts)
          .where(eq(daydreamThoughts.id, id))
          .limit(1);
        if (!row) return json({ error: `no such thought: ${id}` }, { status: 404 });

        const { recordReview, reviewThought } = await import('$lib/daydream/adjudicate');
        const review = await reviewThought(row);
        // A reviewer that could not run leaves the thought unreviewed rather
        // than recording a verdict nobody reached — the same rule the heartbeat
        // follows, and the safe direction, since an unreviewed thought is
        // silent.
        if (review.error) return json({ error: review.error }, { status: 502 });

        await recordReview(id, review);
        const { recordRulingMemory } = await import('$lib/daydream/rulings');
        const ruling = await recordRulingMemory(id, {
          kind: row.kind,
          title: row.title,
          verdict: review.verdict,
          likelihood: review.likelihood,
          reasoning: review.reasoning,
          sources: review.sources,
        });

        return json({
          ok: true,
          verdict: review.verdict,
          likelihood: review.likelihood,
          reasoning: review.reasoning,
          sources: review.sources,
          toolCalls: review.toolCalls,
          memoryId: ruling.memoryId,
          memory: ruling.content,
        });
      }

      case 'rulings': {
        const limit = Number(body.limit);
        const { listRulings } = await import('$lib/daydream/rulings');
        return json({ rulings: await listRulings(Number.isFinite(limit) ? limit : 50) });
      }

      // ── What it knows, and what each memory does ──────────────────────
      //
      // A sibling of `rulings` rather than a replacement. It shows the two
      // raw inputs to Daydream's learning loop: reviewer findings and notes on
      // Daydream thoughts. The underlying memory table is shared site-wide,
      // so the query enforces that admission boundary explicitly.
      case 'memories': {
        const limit = Number(body.limit);
        const { loadMemoryOverview } = await import('$lib/daydream/memories.server');
        return json(await loadMemoryOverview(Number.isFinite(limit) ? limit : 200));
      }

      // A visible bootstrap/retry for the nightly process. The same idempotent
      // writer and validator as the scheduled activity; `allowRepeat` only
      // means "look for memories added after tonight's completed run".
      case 'consolidate_memories': {
        const { budgetStatus } = await import('$lib/daydream/budget');
        const { resolveDaydreamModel } = await import('$lib/daydream/compose');
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
      case 'lead_detail': {
        const leadId = str('leadId');
        if (!leadId) return json({ error: 'leadId is required' }, { status: 400 });
        const { loadLeadDetail } = await import('$lib/daydream/leads/detail');
        const detail = await loadLeadDetail(leadId);
        if (!detail) return json({ error: 'no such lead' }, { status: 404 });
        return json({ detail });
      }

      // ── The relevance dial ────────────────────────────────────────────
      //
      // Deliberately NOT folded into `feedback`. That action writes a status
      // (`actioned` or `dismissed`) and a verdict on the SUGGESTION; this one
      // writes neither, because how much a subject matters is a different
      // question from whether an interruption was worth having, and conflating
      // them would record an opinion John did not give. `null` clears it.
      case 'set_relevance': {
        const id = str('id');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const raw = body.relevance;
        if (raw !== null && typeof raw !== 'number') {
          return json({ error: 'relevance must be a number 1..5, or null' }, { status: 400 });
        }
        const { setRelevance } = await import('$lib/daydream/thought-store');
        return json({ ok: true, ...(await setRelevance(id, raw)) });
      }

      // ── Into the graph ────────────────────────────────────────────────
      //
      // A separate call rather than a side effect of the vote. `recordFeedback`
      // is also reached from the WhatsApp reply handler and from the triage
      // deck thirty rows at a time, and an LLM extraction inside it would put a
      // model call behind a bulk sorting pass and behind an inbound message.
      // The vote is the thing this whole loop is starved of; it must never wait
      // on the graph.
      case 'weave': {
        const id = str('id');
        if (!id) return json({ error: 'id is required' }, { status: 400 });
        const { weaveThought } = await import('$lib/daydream/weave');
        return json({ ok: true, weave: await weaveThought(id) });
      }

      // ── Writing to the diary ──────────────────────────────────────────
      //
      // Everything above this point reads the calendar or records what the
      // OWNER thinks of an entry. These three write to iCloud, through the same
      // registry tools the chat surface uses, so there is one CalDAV client and
      // one set of argument names. The tools are marked `destructive` because a
      // model calling them needs a confirmation gate; here the button IS the
      // confirmation, on an owner-gated route, the same shape `run_action`
      // already has.
      case 'calendar_list': {
        const { executeTool } = await import('$lib/workflows/site-tools/registry');
        const res = await executeTool('apple_calendar_list', { listCalendars: true });
        if (!res?.success) {
          return json({ error: String(res?.error ?? 'could not read the calendar list') }, { status: 502 });
        }
        return json({ calendars: (res.data as { calendars?: unknown[] })?.calendars ?? [] });
      }

      case 'create_event': {
        const calendar = str('calendar');
        const title = str('title');
        if (!calendar) return json({ error: 'pick a calendar to write to' }, { status: 400 });
        if (!title) return json({ error: 'an event needs a title' }, { status: 400 });

        const start = str('start');
        const end = str('end');
        const allDayStart = str('allDayStart');
        const allDayEnd = str('allDayEnd');
        // One shape or the other, never neither — a create with no times at all
        // silently lands on today at midnight, which is a wrong entry in a real
        // calendar rather than an error anyone would see.
        if (!start && !allDayStart) {
          return json({ error: 'give it a start time, or an all-day date' }, { status: 400 });
        }

        const { executeTool } = await import('$lib/workflows/site-tools/registry');
        const res = await executeTool('apple_calendar_create', {
          calendar,
          title,
          ...(start ? { start } : {}),
          ...(end ? { end } : {}),
          // All-day dates travel as a PAIR. `allDayEnd` alone is meaningless
          // and `allDayStart` alone leaves the end for the server to guess, so
          // a single-day entry states both and says the same date twice. (The
          // inner `|| allDayStart` was unreachable while this was two spreads
          // guarded on `allDayEnd`.)
          ...(allDayStart ? { allDayStart, allDayEnd: allDayEnd || allDayStart } : {}),
          ...(str('location') ? { location: str('location') } : {}),
          ...(str('notes') ? { notes: str('notes') } : {}),
        });
        if (!res?.success) {
          return json({ error: String(res?.error ?? 'the calendar refused that') }, { status: 502 });
        }
        return json({ ok: true, event: res.data });
      }

      case 'update_event': {
        const calendar = str('calendar');
        const eventId = str('eventId');
        if (!calendar || !eventId) {
          return json({ error: 'calendar and eventId are required' }, { status: 400 });
        }
        // Only what was supplied. The tool preserves omitted fields, so sending
        // an empty string for something the caller did not touch would CLEAR it
        // — `location: ''` is how the tool spells "remove the location".
        const patch: Record<string, unknown> = { calendar, eventId };
        for (const field of ['title', 'start', 'end', 'allDayStart', 'allDayEnd', 'location', 'notes']) {
          if (typeof body[field] === 'string') patch[field] = (body[field] as string).trim();
        }
        if (Object.keys(patch).length === 2) {
          return json({ error: 'nothing to change' }, { status: 400 });
        }

        const { executeTool } = await import('$lib/workflows/site-tools/registry');
        const res = await executeTool('apple_calendar_update', patch);
        if (!res?.success) {
          return json({ error: String(res?.error ?? 'the calendar refused that') }, { status: 502 });
        }
        return json({ ok: true, event: res.data });
      }

      /**
       * The owner ruling on what the engine would like to build.
       *
       * `accept` does NOT build anything — it moves the lead to `queued`, and
       * the next self-improvement run picks queued leads up under its own
       * switches. Keeping the tap and the spend apart is deliberate: a button
       * that starts a repo build costs real money, and the thing that decides
       * to spend it should be the engine's own budgeted phase, not a click.
       *
       * `decline` is permanent by design. `upsertCapability` refuses to
       * re-open a declined row, so a no stays a no — the proposer cannot
       * re-litigate its own refusals the way the 19–29 Jul runs re-proposed
       * "news digest" every night for ten nights.
       */
      case 'capability_decide': {
        const slug = str('slug');
        const decision = str('decision');
        if (!slug) return json({ error: 'slug is required' }, { status: 400 });
        if (decision !== 'accept' && decision !== 'decline') {
          return json({ error: 'decision must be accept or decline' }, { status: 400 });
        }
        const { setCapabilityStatus } = await import('$lib/daydream/appetite/store');
        const moved = await setCapabilityStatus(slug, decision === 'accept' ? 'queued' : 'declined', {
          by: 'owner',
          outcome: decision === 'accept' ? 'Accepted — waiting for a build slot.' : 'Declined by the owner.',
        });
        if (!moved) return json({ error: 'no such capability' }, { status: 404 });
        return json({ ok: true, slug, status: decision === 'accept' ? 'queued' : 'declined' });
      }

      // ── The queue board (2026-09-04) ───────────────────────────────────
      //
      // Four edits on `improvement_backlog`, all keyed by slug. They exist
      // because the queue reached 455 rows with 280 of the 352 open ones tied
      // on priority 2: the engine could add to the pile and nothing could
      // sort, merge or close it.
      //
      // None of them spends anything. Accepting work queues it for a slot the
      // lane still gates — a repo build can cost £2 and
      // `daydream.appetite.autobuild` is deliberately inverted, so a drag on a
      // board must never be what starts one.

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
        const { findThemes } = await import('$lib/selfimprove/epics');
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
    console.error(`[daydream] action ${action} failed:`, errMsg(err));
    return json({ error: errMsg(err) }, { status: 400 });
  }
};
