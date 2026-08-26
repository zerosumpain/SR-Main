// Owner-gated actions on the daydream ledger.
//
// NOT in PUBLIC_PATHS, and must never be: only `/api/daydream/observe` is
// listed there, as an exact path, precisely so this sibling stays behind the
// Auth.js gate. Everything here reads or writes the owner's movements and
// judgements.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadLedger, snoozeThought, unmuteKind } from '$lib/daydream/ledger';
import { recordFeedback } from '$lib/daydream/thought-store';
import { confirmPlace, ignorePlace, isPlaceKind } from '$lib/daydream/places';
import { errMsg } from '$lib/daydream/types';

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
        return json({ ok: true, suggestion: await suggestPlaceName(place.lat, place.lon) });
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
