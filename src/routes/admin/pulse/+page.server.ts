import type { PageServerLoad } from './$types';

/**
 * The page hydrates from the same /api/admin/pulse/* endpoints it polls
 * once mounted, so server load just kicks them off in parallel for the
 * first paint.
 */
export const load: PageServerLoad = async ({ fetch }) => {
  const [live, schedules, feed] = await Promise.all([
    fetch('/api/admin/pulse/live').then((r) => r.json()),
    fetch('/api/admin/pulse/schedules').then((r) => r.json()),
    fetch('/api/admin/pulse/feed?limit=100').then((r) => r.json()),
  ]);
  return { live, schedules: schedules.schedules, feed: feed.items };
};
