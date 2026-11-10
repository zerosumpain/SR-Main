import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadRegisterRoom } from '$lib/daydream/register.server';
import { registerSummary } from '$lib/daydream/register';
import { ASK_ONLY, EMPTY_AUTONOMY, ladderView } from '$lib/daydream/act/autonomy';
import { loadAutonomy } from '$lib/daydream/act/autonomy.server';

// Owner-gated by hooks (the whole /jkai area is owner-only).
export const load: PageServerLoad = async () => {
  const now = new Date();
  // The ladder is read apart from the register: one failing must not blank the other.
  const state = await loadAutonomy().catch((err) => {
    console.error('[daydream] autonomy not read:', errMsg(err));
    return EMPTY_AUTONOMY;
  });
  const autonomy = { ladder: ladderView(state, now), askOnly: ASK_ONLY, recent: state.log.slice(-8).reverse() };
  try {
    const room = await loadRegisterRoom(now);
    // A build's progress lives on the backlog: look each slug up once.
    const slugs = new Set(room.entries.filter((e) => e.ref && e.href?.startsWith('/jkai/develop/backlog')).map((e) => e.ref!));
    if (slugs.size) {
      try {
        const { listBacklog } = await import('$lib/selfimprove/backlog');
        const items = new Map((await listBacklog()).map((i) => [i.slug, i]));
        for (const e of room.entries) {
          const it = e.ref ? items.get(e.ref) : undefined;
          if (!it) continue;
          const accepted = !!(it.grooming as { acceptedAt?: unknown } | undefined)?.acceptedAt;
          e.result = it.status === 'open' ? (accepted ? 'Accepted — waiting for its overnight build.' : 'Proposed — waiting for your accept on the backlog.') : `Backlog: ${it.status}.`;
        }
      } catch (err) {
        console.error('[daydream] register: backlog not read:', errMsg(err));
      }
    }
    return { ...room, autonomy, summary: registerSummary(room.entries, now), error: null as string | null };
  } catch (err) {
    console.error('[daydream] register load failed:', errMsg(err));
    return { entries: [], trackers: [], autonomy, summary: registerSummary([], now), error: errMsg(err) };
  }
};
