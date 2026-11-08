// The family backlog as a linked TV sees it: only videos the server can
// fetch and play (`castRoute`), still on the list, newest first — and no
// email addresses, only the sharer's first name.

import { castRoute } from '$lib/family/backlog-cast';
import type { BacklogRecord } from '$lib/family/backlog';
import type { TvBacklogItem } from './tv-backlog';

/** A TV page of the list is short: an evening's worth. */
export const TV_BACKLOG_MAX = 40;

const PROVIDER_NAME: Record<string, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

/** The playable videos, newest first, with first names from `names` (email → name). PURE. */
export function tvBacklogItems(items: BacklogRecord[], names: Map<string, string>): TvBacklogItem[] {
  return items
    .filter((i) => i.status === 'new' && castRoute(i).fetch)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, TV_BACKLOG_MAX)
    .map((i) => ({
      id: i.id,
      title: i.title?.trim() || i.siteName?.trim() || `A ${PROVIDER_NAME[i.provider ?? ''] ?? 'shared'} video`,
      provider: PROVIDER_NAME[i.provider ?? ''] ?? 'Video',
      thumbnailUrl: i.thumbnailUrl,
      sharedBy: names.get(i.addedByEmail.toLowerCase()) ?? null,
      createdAt: i.createdAt.toISOString(),
    }));
}
