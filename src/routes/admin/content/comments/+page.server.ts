import { commentStatusCounts, moderationQueue } from '$lib/blog/comments.server';
import type { PageServerLoad } from './$types';

/** The tab the page opens on. Held first because the queue exists for the
 *  comments still waiting on a decision — opening on 'all' buries four held
 *  comments under two hundred already-published ones. */
const INITIAL_STATUS = 'held' as const;

export const load: PageServerLoad = async () => {
  // Both reads happen server-side so the first paint is the real queue rather
  // than a spinner: every subsequent tab is a client fetch against
  // /api/admin/blog/comments, which returns the same shape.
  const [comments, counts] = await Promise.all([
    moderationQueue(INITIAL_STATUS),
    commentStatusCounts(),
  ]);

  return { status: INITIAL_STATUS, comments, counts };
};
