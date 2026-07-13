import { redirect } from '@sveltejs/kit';

// /value was renamed to /outcomes in the 2026-07-13 research-flow reorg.
export const load = () => {
  throw redirect(308, '/projects/data-spine/outcomes');
};
