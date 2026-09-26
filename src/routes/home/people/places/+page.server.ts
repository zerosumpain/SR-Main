import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { errMsg } from '$lib/home/presence/types';
import { validPlaceGeometry } from '$lib/home/presence/geo';
import {
  PLACE_KINDS,
  PLACE_LABEL_MAX,
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  confirmPlace,
  createPlace,
  isPlaceKind,
  listPanelPlaces,
  updatePlaceAlerts,
  updatePlaceGeometry,
  type PanelPlace,
} from '$lib/home/presence/places';

// The owner's places panel: which places raise arrive/leave alerts (and in
// which direction), which of those also go by WhatsApp, what each is called,
// where it is and how wide (spec section 6). The map moves, resizes and
// creates places; the list does everything else, and all of it without the
// map too. Owner only. The hook already refuses anyone else (this route is not
// a household route); the load and EVERY action check again, because a form
// action is a POST anyone can make.

export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) error(403, 'Forbidden');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const fixed = {
    radius: { min: RADIUS_MIN_M, max: RADIUS_MAX_M },
    // The picker for a place drawn on the map: 'unknown' is the engine's
    // "not asked yet", never an answer.
    kinds: PLACE_KINDS.filter((k) => k !== 'unknown'),
    labelMax: PLACE_LABEL_MAX,
  };
  try {
    return { places: await listPanelPlaces(), ...fixed, loadError: null as string | null };
  } catch (err) {
    console.error('[home/people/places] load failed:', errMsg(err));
    return { places: [] as PanelPlace[], ...fixed, loadError: errMsg(err) };
  }
};

function on(form: FormData, name: string): boolean {
  return form.get(name) === 'on' || form.get(name) === 'true';
}

/** A number from a form field, or NaN when it is missing or blank (Number('')
 *  is 0, which would put a blank latitude on the equator). */
function num(form: FormData, name: string): number {
  const raw = String(form.get(name) ?? '').trim();
  return raw ? Number(raw) : Number.NaN;
}

/** Centre and radius from a form, or the reason they are refused. */
function geometryFrom(form: FormData): { lat: number; lon: number; radiusM: number } | { error: string } {
  const lat = num(form, 'lat');
  const lon = num(form, 'lon');
  const radiusM = Math.round(num(form, 'radiusM'));
  const bad = validPlaceGeometry(lat, lon, radiusM);
  return bad ? { error: bad } : { lat, lon, radiusM };
}

/** The panel place a form names, or the failure to return. */
async function panelPlace(form: FormData) {
  const placeId = String(form.get('placeId') ?? '').trim();
  if (!placeId) return { failure: fail(400, { error: 'No place given.', placeId: null }) };
  const place = (await listPanelPlaces()).find((p) => p.id === placeId);
  if (!place) return { failure: fail(404, { error: 'That place is not on the panel.', placeId }) };
  return { place };
}

const OWNER_ONLY = () => fail(403, { error: 'Owner access required.', placeId: null });

export const actions: Actions = {
  /** The list's editor: the name, and the edge (the radius, plus the centre
   *  when the map moved it). Any change to the edge pins the place. */
  save: async (event) => {
    if (!(await isOwnerRequest(event))) return OWNER_ONLY();
    const form = await event.request.formData();
    const found = await panelPlace(form);
    if (!found.place) return found.failure;
    const place = found.place;
    const placeId = place.id;

    const label = String(form.get('label') ?? '').trim();
    if (label.length > 200) return fail(400, { error: 'Keep the name under 200 characters.', placeId });
    if (!label && place.label) return fail(400, { error: 'A named place needs a name.', placeId });

    const radiusRaw = String(form.get('radiusM') ?? '').trim();
    const radiusM = Math.round(Number(radiusRaw));
    if (!radiusRaw || !Number.isFinite(radiusM) || radiusM < RADIUS_MIN_M || radiusM > RADIUS_MAX_M) {
      return fail(400, { error: `The radius must be ${RADIUS_MIN_M}–${RADIUS_MAX_M} m.`, placeId });
    }
    // The centre is sent when the page has a map; without one, only the radius.
    const hasCentre = String(form.get('lat') ?? '').trim() !== '' || String(form.get('lon') ?? '').trim() !== '';
    const geo = hasCentre ? geometryFrom(form) : null;
    if (geo && 'error' in geo) return fail(400, { error: geo.error, placeId });
    const moved = !!geo && (geo.lat !== place.lat || geo.lon !== place.lon);

    try {
      if (label && label !== place.label) {
        // Through confirmPlace, so the name in jkai's memory moves with it.
        await confirmPlace(place.id, label, isPlaceKind(place.kind) ? place.kind : 'other');
      }
      if (geo && moved) await updatePlaceGeometry(place.id, geo);
      else if (radiusM !== Math.round(place.radiusM)) await updatePlaceAlerts(place.id, { radiusM });
    } catch (err) {
      console.error('[home/people/places] save failed:', errMsg(err));
      return fail(500, { error: 'That did not save. Try again.', placeId });
    }
    return { saved: placeId };
  },

  /** The map's own Save: a dragged centre and radius. Pins the place. */
  move: async (event) => {
    if (!(await isOwnerRequest(event))) return OWNER_ONLY();
    const form = await event.request.formData();
    const found = await panelPlace(form);
    if (!found.place) return found.failure;
    const placeId = found.place.id;
    const geo = geometryFrom(form);
    if ('error' in geo) return fail(400, { error: geo.error, placeId });
    try {
      await updatePlaceGeometry(placeId, geo);
    } catch (err) {
      console.error('[home/people/places] move failed:', errMsg(err));
      return fail(500, { error: 'That did not save. Try again.', placeId });
    }
    return { moved: placeId };
  },

  /** A place drawn on the map: named, pinned, no visits yet. */
  create: async (event) => {
    if (!(await isOwnerRequest(event))) return OWNER_ONLY();
    const form = await event.request.formData();
    const label = String(form.get('label') ?? '').trim();
    if (!label || label.length > PLACE_LABEL_MAX) {
      return fail(400, { error: `Give the place a name of 1–${PLACE_LABEL_MAX} characters.`, placeId: null });
    }
    const kindRaw = form.get('kind');
    const kind = isPlaceKind(kindRaw) ? kindRaw : 'other';
    const geo = geometryFrom(form);
    if ('error' in geo) return fail(400, { error: geo.error, placeId: null });

    let id: string;
    try {
      ({ id } = await createPlace({ label, kind, ...geo }));
    } catch (err) {
      console.error('[home/people/places] create failed:', errMsg(err));
      return fail(500, { error: 'That place did not save. Try again.', placeId: null });
    }
    try {
      // The name into jkai's memory, as naming any place does. The place
      // stands without it: a failure here is logged, not undone.
      await confirmPlace(id, label, kind);
    } catch (err) {
      console.error('[home/people/places] created place not written to memory:', errMsg(err));
    }
    return { created: id };
  },

  /** Who hears about a crossing: the master switch, which directions, and
   *  WhatsApp. Submitted as each switch changes. */
  notify: async (event) => {
    if (!(await isOwnerRequest(event))) return OWNER_ONLY();
    const form = await event.request.formData();
    const found = await panelPlace(form);
    if (!found.place) return found.failure;
    const place = found.place;
    const whatsappAlerts = on(form, 'whatsappAlerts');
    // WhatsApp rides on an alert: a place nobody watches raises nothing to
    // send. Home is watched by the code whatever its flag says, so its stored
    // flag is left exactly as it is.
    const alerts = place.isHome ? undefined : on(form, 'alerts') || whatsappAlerts;
    try {
      await updatePlaceAlerts(place.id, {
        ...(alerts === undefined ? {} : { alerts }),
        alertArrive: on(form, 'alertArrive'),
        alertLeave: on(form, 'alertLeave'),
        whatsappAlerts,
      });
    } catch (err) {
      console.error('[home/people/places] notify failed:', errMsg(err));
      return fail(500, { error: 'That did not save. Try again.', placeId: place.id });
    }
    return { notified: place.id };
  },
};
