// The family backlog on sr. tv: the videos the family shared from the app
// (Share → SR), as the TV's Watch row lists them, and the two calls the TV
// makes — the list, and "get this one ready" (the same server fetch the
// app's Play on TV uses, `$lib/family/backlog-cast`). The TV only reads and
// plays: marking a video watched stays with a person, who has a name.

import type { CastWire } from '$lib/family/backlog-cast';

export interface TvBacklogItem {
  id: string;
  title: string;
  provider: string;
  thumbnailUrl: string | null;
  /** First name of whoever shared it, or null when nobody on the roster matches. */
  sharedBy: string | null;
  createdAt: string;
}

export type { CastWire };

async function answer<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export async function fetchTvBacklog(): Promise<TvBacklogItem[]> {
  const out = await answer<{ items: TvBacklogItem[] }>(await fetch('/api/games/tv/backlog', { cache: 'no-store' }));
  return out.items;
}

export async function castTvItem(id: string): Promise<CastWire> {
  return answer<CastWire>(
    await fetch('/api/games/tv/backlog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }),
  );
}
