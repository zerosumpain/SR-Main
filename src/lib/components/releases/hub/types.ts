import type { CadenceWeek, ConsolePayload } from '$lib/releases/console';
import type { KindSlice, ShowcaseItem, ShowcaseTotals } from '$lib/releases/public';

export type ReleasesAudience = 'owner' | 'public';

/** What an anonymous reader gets — see the loader for what is withheld and why. */
export interface PublicReleasesData {
  mode: 'public';
  totals: ShowcaseTotals;
  cadence: CadenceWeek[];
  kindMix: KindSlice[];
  items: ShowcaseItem[];
  filters: { kind: string; q: string };
}

/** What the owner gets — the whole console, formerly /admin/ops/releases. */
export interface OwnerReleasesData extends ConsolePayload {
  mode: 'owner';
}

export type ReleasesData = OwnerReleasesData | PublicReleasesData;

/** One cell of the masthead's figure grid. */
export interface Tile {
  label: string;
  value: string;
  note?: string;
}
