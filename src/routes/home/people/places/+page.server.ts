import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { errMsg } from '$lib/home/presence/types';
import {
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  confirmPlace,
  isPlaceKind,
  listPanelPlaces,
  updatePlaceAlerts,
  type PanelPlace,
} from '$lib/home/presence/places';

// The owner's places panel: which places raise arrive/leave alerts, which of
// those also go by WhatsApp, what each is called and how wide it is (spec
// section 6). Owner only. The hook already refuses anyone else (this route is
// not a household route); the load and EVERY action check again, because a
// form action is a POST anyone can make.

export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) error(403, 'Forbidden');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  try {
    return { places: await listPanelPlaces(), radius: { min: RADIUS_MIN_M, max: RADIUS_MAX_M }, loadError: null as string | null };
  } catch (err) {
    console.error('[home/people/places] load failed:', errMsg(err));
    return { places: [] as PanelPlace[], radius: { min: RADIUS_MIN_M, max: RADIUS_MAX_M }, loadError: errMsg(err) };
  }
};

function on(form: FormData, name: string): boolean {
  return form.get(name) === 'on' || form.get(name) === 'true';
}

export const actions: Actions = {
  save: async (event) => {
    if (!(await isOwnerRequest(event))) return fail(403, { error: 'Owner access required.', placeId: null });
    const form = await event.request.formData();
    const placeId = String(form.get('placeId') ?? '').trim();
    if (!placeId) return fail(400, { error: 'No place given.', placeId: null });

    const places = await listPanelPlaces();
    const place = places.find((p) => p.id === placeId);
    if (!place) return fail(404, { error: 'That place is not on the panel.', placeId });

    const label = String(form.get('label') ?? '').trim();
    if (label.length > 200) return fail(400, { error: 'Keep the name under 200 characters.', placeId });
    if (!label && place.label) return fail(400, { error: 'A named place needs a name.', placeId });

    const radiusRaw = String(form.get('radiusM') ?? '').trim();
    const radiusM = Math.round(Number(radiusRaw));
    if (!radiusRaw || !Number.isFinite(radiusM) || radiusM < RADIUS_MIN_M || radiusM > RADIUS_MAX_M) {
      return fail(400, { error: `The radius must be ${RADIUS_MIN_M}–${RADIUS_MAX_M} m.`, placeId });
    }

    const whatsappAlerts = on(form, 'whatsappAlerts');
    // WhatsApp rides on an alert: a place nobody watches raises nothing to
    // send. Home is always watched.
    const alerts = on(form, 'alerts') || (whatsappAlerts && !place.isHome);

    try {
      if (label && label !== place.label) {
        // Through confirmPlace, so the name in jkai's memory moves with it.
        await confirmPlace(place.id, label, isPlaceKind(place.kind) ? place.kind : 'other');
      }
      await updatePlaceAlerts(place.id, {
        alerts,
        whatsappAlerts,
        ...(radiusM !== Math.round(place.radiusM) ? { radiusM } : {}),
      });
    } catch (err) {
      console.error('[home/people/places] save failed:', errMsg(err));
      return fail(500, { error: 'That did not save. Try again.', placeId });
    }
    return { saved: placeId };
  },
};
