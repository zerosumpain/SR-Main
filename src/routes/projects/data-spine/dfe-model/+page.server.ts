import { redirect } from '@sveltejs/kit';

// /dfe-model was renamed to /model in the 2026-07-13 research-flow reorg.
export const load = () => {
  throw redirect(308, '/projects/data-spine/model');
};
