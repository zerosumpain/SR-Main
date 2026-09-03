import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadDelivery, loadPlaces } from '$lib/daydream/ledger';

type Places = Awaited<ReturnType<typeof loadPlaces>>;
type Delivery = Awaited<ReturnType<typeof loadDelivery>>;

/**
 * The place table, and the one delivery number the page reasons with.
 *
 * `minVisitsToAsk` is read from the ledger rather than kept as a local copy,
 * because the room draws the line between "a question" and "too quiet to ask"
 * with it — and a second copy of that constant is a page that disagrees with
 * the engine about which places it is interrupting the owner over.
 *
 * The naming QUEUE is not loaded here on purpose: sixty rows with a
 * reverse-geocode behind each is not a cost every arrival should pay. It stays
 * on demand, fetched by the session component when the button is pressed.
 *
 * Settled rather than all-or-nothing: `loadDelivery` reaches into `deliver.ts`
 * for a push-subscriber check, and losing the whole place table to that would
 * be a blank room over a number with a sane default.
 */
export const load: PageServerLoad = async () => {
  const [placesRes, deliveryRes] = await Promise.allSettled([loadPlaces(), loadDelivery()]);

  let places: Places = [];
  let delivery: Delivery | null = null;
  let loadError: string | null = null;

  if (placesRes.status === 'fulfilled') {
    places = placesRes.value;
  } else {
    loadError = errMsg(placesRes.reason);
    console.error('[daydream] places load failed:', loadError);
  }
  if (deliveryRes.status === 'fulfilled') {
    delivery = deliveryRes.value;
  } else {
    const msg = errMsg(deliveryRes.reason);
    console.error('[daydream] places load failed:', msg);
    loadError = loadError ? `${loadError}; ${msg}` : msg;
  }

  return { places, delivery, loadError };
};
