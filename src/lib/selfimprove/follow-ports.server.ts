// src/lib/selfimprove/follow-ports.server.ts
//
// The improvement backlog as daydream's follow-ups need it (`BacklogPorts` in
// `$lib/daydream/act/follow.server`). It lives on this side of the boundary
// because `$lib/selfimprove` imports `$lib/daydream`; daydream importing the
// backlog back would close a module cycle. Both the web card's route and the
// phone's route hand these ports in.

import type { BacklogPorts } from '$lib/daydream/act/follow.server';
import { getBacklogItem, intakeIdeas, listBacklog, updateBacklogItem } from './backlog';

export function backlogPorts(): BacklogPorts {
  return {
    async intake(idea) {
      const res = await intakeIdeas([{ title: idea.title, detail: idea.detail, kind: 'feature', priority: 3, source: 'think', ref: idea.ref }]);
      const slug = res.added[0] ?? res.merged[0]?.into;
      if (slug) return { slug };
      return { reason: res.outcomes[0] === 'capped' ? 'The backlog has taken its limit of new ideas for the last 24 hours. Try again tomorrow.' : 'The backlog could not be read just now.' };
    },
    async item(slug) {
      const it = await getBacklogItem(slug);
      return it ? { slug: it.slug, title: it.title, detail: it.detail ?? '', kind: it.kind, priority: it.priority, status: it.status } : null;
    },
    async groom(item) {
      // The one groomer: the same brief, and the same check, the board's
      // "Groom" button produces.
      const { groomBacklogItem } = await import('$lib/jkai/development-brief.server');
      const all = await listBacklog();
      const stored = all.find((i) => i.slug === item.slug);
      const result = await groomBacklogItem({ slug: item.slug, title: item.title, detail: item.detail, kind: item.kind, priority: item.priority }, all, stored?.grooming?.lint);
      return result.grooming as unknown as Record<string, unknown>;
    },
    async accept(item, grooming) {
      await updateBacklogItem(item.slug, { title: item.title, detail: item.detail, kind: item.kind, priority: item.priority, grooming });
    },
  };
}
