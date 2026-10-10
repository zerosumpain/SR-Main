import { loadView } from '$lib/components/landing/page-view.svelte';
import type { PageLoad } from './$types';

// The chosen view arrives with the page, hero and showcase both, so the server
// renders them and the client hydrates them with nothing to wait for; the
// other two views load only when the visitor reaches for the switch. Three
// views in one bundle would put the home route past its client budget for
// pictures nobody asked to see.
export const load: PageLoad = async ({ data }) => {
  const { hero, showcase } = await loadView(data.heroView.view);
  return { ...data, heroComponent: hero, showcaseComponent: showcase };
};
