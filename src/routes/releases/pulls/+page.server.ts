import { error } from '@sveltejs/kit';
import { isOwnerRequest } from '$lib/server/owner';
import { loadPullDesk, mergeVerdict } from '$lib/github/pull-desk.server';
import type { PageServerLoad } from './$types';

/**
 * The pull-request desk: open PRs across the owner's repositories, with merge,
 * close and revert. Owner only — the hook already denies this route to anyone
 * else (it is in no public list or access grant); the 404 here is the second
 * lock, so a future grant on /releases cannot open it by accident.
 *
 * Read live on every load, no cache: the page exists to act, and acting on a
 * five-minute-old picture of a PR is the mistake the merge guards are for.
 */
export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) throw error(404, 'Not found');
  try {
    const desk = await loadPullDesk();
    const now = Date.now();
    return {
      ok: true as const,
      open: desk.open.map((p) => ({ ...p, verdict: mergeVerdict(p, now) })),
      merged: desk.merged,
      fetchedAt: desk.fetchedAt,
    };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : 'GitHub could not be reached' };
  }
};
