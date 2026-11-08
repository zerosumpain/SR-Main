import { loadProjectsView } from '$lib/components/projects/projects-view.svelte';
import type { PageLoad } from './$types';

// The chosen view arrives with the page, so the server renders it and the
// client hydrates it with nothing to wait for; the other two load only when
// the visitor reaches for the switch (see projects-view.svelte.ts).
export const load: PageLoad = async ({ data }) => {
  return { ...data, viewComponent: await loadProjectsView(data.view.view) };
};
