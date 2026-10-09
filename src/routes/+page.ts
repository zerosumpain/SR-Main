import { loadHeroView } from '$lib/components/landing/HeroViews.svelte';
import type { PageLoad } from './$types';

// The hero's chosen view arrives with the page, so the server renders it and
// the client hydrates it with nothing to wait for; the other two load only
// when the visitor reaches for the switch. Three views in one bundle would put
// the home route past its client budget for pictures nobody asked to see.
export const load: PageLoad = async ({ data }) => ({
  ...data,
  heroComponent: await loadHeroView(data.heroView.view),
});
