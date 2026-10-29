import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadRegisterRoom } from '$lib/daydream/register.server';
import { registerSummary } from '$lib/daydream/register';

// Owner-gated by hooks (the whole /jkai area is owner-only).
export const load: PageServerLoad = async () => {
  const now = new Date();
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
    return { ...room, summary: registerSummary(room.entries, now), error: null as string | null };
  } catch (err) {
    console.error('[daydream] register load failed:', errMsg(err));
    return { entries: [], trackers: [], summary: registerSummary([], now), error: errMsg(err) };
  }
};
