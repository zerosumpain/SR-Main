import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { loadMemoryOverview } from '$lib/daydream/memories.server';
import { listRulings } from '$lib/daydream/rulings';
import type {
  DaydreamMemory,
  DaydreamMemoryThemeView,
  MemoryConsolidationView,
} from '$lib/daydream/memories';
import type { RulingListRow } from '$lib/daydream/rooms/memory';

// What Daydream learned, loaded on arrival rather than on a click.
//
// The monolith fetched both halves of this room through `POST
// /api/daydream/thoughts` from an effect, because the page payload already
// carried sixteen ledger loaders for eleven tabs and most visits never opened
// this one. A room is its own route now, so that cost is gone and the two
// calls the API handlers make — `loadMemoryOverview` for `memories`,
// `listRulings` for `rulings` — happen here instead. The API actions stay
// exactly as they are; the consolidate button still uses one.
//
// The two loads are caught SEPARATELY. They are independent queries against
// different tables, and a rulings failure that blanked the themes would report
// "it has learned nothing" for a fault in a list underneath them.
const MEMORY_LIMIT = 200;
const RULING_LIMIT = 80;

export const load: PageServerLoad = async () => {
  const errors: string[] = [];

  const [overview, rulings] = await Promise.all([
    loadMemoryOverview(MEMORY_LIMIT).catch((err) => {
      console.error('[daydream] memory load failed:', errMsg(err));
      errors.push(`memories: ${errMsg(err)}`);
      return null;
    }),
    listRulings(RULING_LIMIT).catch((err) => {
      console.error('[daydream] memory load failed:', errMsg(err));
      errors.push(`rulings: ${errMsg(err)}`);
      return null;
    }),
  ]);

  return {
    memories: (overview?.memories ?? []) as DaydreamMemory[],
    themes: (overview?.themes ?? []) as DaydreamMemoryThemeView[],
    lastConsolidation: (overview?.lastConsolidation ?? null) as MemoryConsolidationView | null,
    rulings: (rulings ?? []) as RulingListRow[],
    loadError: errors.length ? errors.join(' · ') : null,
  };
};
