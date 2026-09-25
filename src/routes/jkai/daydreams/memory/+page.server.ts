import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadMemoryOverview } from '$lib/daydream/memories.server';
import type {
  DaydreamMemory,
  DaydreamMemoryThemeView,
  MemoryConsolidationView,
} from '$lib/daydream/memories';

// What Daydream learned, loaded on arrival rather than on a click.
//
// The monolith fetched both halves of this room through `POST
// /api/daydream/thoughts` from an effect, because the page payload already
// carried sixteen ledger loaders for eleven tabs and most visits never opened
// this one. A room is its own route now, so that cost is gone and
// `loadMemoryOverview` runs here instead; the consolidate button still POSTs.
// The reviewer's rulings list went with the reviewer in P4a (2026-09-25).
const MEMORY_LIMIT = 200;

export const load: PageServerLoad = async () => {
  const errors: string[] = [];

  const overview = await loadMemoryOverview(MEMORY_LIMIT).catch((err) => {
    console.error('[daydream] memory load failed:', errMsg(err));
    errors.push(`memories: ${errMsg(err)}`);
    return null;
  });

  return {
    memories: (overview?.memories ?? []) as DaydreamMemory[],
    themes: (overview?.themes ?? []) as DaydreamMemoryThemeView[],
    lastConsolidation: (overview?.lastConsolidation ?? null) as MemoryConsolidationView | null,
    loadError: errors.length ? errors.join(' · ') : null,
  };
};
