import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { legacyTabTarget } from '$lib/daydream/hub-counts';

// Every room of the hub is its own route now. The bare path — and every old
// `?tab=` link, of which there were dozens in notifications, evidence trails
// and nav registries — lands on the room it named, with the rest of the
// query intact so a `?rate=` deep link still opens its thought.
export const load: PageServerLoad = ({ url }) => {
  throw redirect(307, legacyTabTarget(url));
};
