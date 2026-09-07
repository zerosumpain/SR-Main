import type { SOURCE_FOOTPRINT } from 'virtual:sr-source-footprint';
import type { CadenceWeek, ConsolePayload } from '$lib/releases/console';
import type { KindSlice, ShowcaseItem, ShowcaseTotals } from '$lib/releases/public';

export type ReleasesAudience = 'owner' | 'public';

/** What an anonymous reader gets — see the loader for what is withheld and why. */
export interface PublicReleasesData {
  mode: 'public';
  sourceFootprint: typeof SOURCE_FOOTPRINT;
  totals: ShowcaseTotals;
  cadence: CadenceWeek[];
  /** The mix over the FILTERED items — it describes what is on the page. */
  kindMix: KindSlice[];
  /** The kinds the whole safe corpus contains — what the picker may offer. */
  kindOptions: string[];
  items: ShowcaseItem[];
  filters: { kind: string; q: string };
}

/** What the owner gets — the whole console, formerly /admin/ops/releases. */
export interface OwnerReleasesData extends ConsolePayload {
  mode: 'owner';
  sourceFootprint: typeof SOURCE_FOOTPRINT;
}

export type ReleasesData = OwnerReleasesData | PublicReleasesData;

/** One cell of the masthead's figure grid. */
export interface Tile {
  label: string;
  value: string;
  note?: string;
}
