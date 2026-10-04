import type { SOURCE_FOOTPRINT } from 'virtual:sr-source-footprint';
import type { CadenceWeek, ConsolePayload, ReleaseMonth } from '$lib/releases/console';
import type { KindSlice, ShowcaseItem, ShowcaseTotals } from '$lib/releases/public';
import type { ReleaseSessionsBand } from '$lib/releases/sessions.server';
import type { SpendBand } from '$lib/releases/spend';

export type ReleasesAudience = 'owner' | 'public';

/** What an anonymous reader gets — see the loader for what is withheld and why. */
export interface PublicReleasesData {
  mode: 'public';
  sourceFootprint: typeof SOURCE_FOOTPRINT;
  today: string;
  totals: ShowcaseTotals;
  cadence: CadenceWeek[];
  timeBuckets: ReleaseMonth[];
  /** The mix over the FILTERED items — it describes what is on the page. */
  kindMix: KindSlice[];
  /** The kinds the whole safe corpus contains — what the picker may offer. */
  kindOptions: string[];
  items: ShowcaseItem[];
  /**
   * The surfaces on this page the viewer can open: public pages, and a
   * member's granted ones. Every other surface prints as text, so a
   * route pattern (`/jkai/canvas/[slug]`) or an owner page is never a link.
   */
  linkable: string[];
  filters: { kind: string; q: string; from: string; to: string };
}

/** What the owner gets — the whole console, formerly /admin/ops/releases. */
export interface OwnerReleasesData extends ConsolePayload {
  mode: 'owner';
  sourceFootprint: typeof SOURCE_FOOTPRINT;
  today: string;
  sampleData?: boolean;
  /**
   * The Claude Code sessions that produced the releases on this page, joined on
   * pull-request number. Owner-only by construction: the public branch of the
   * loader never fetches it, so `PublicReleasesData` has no such member and an
   * anonymous render cannot carry the bytes even by accident.
   */
  sessions: ReleaseSessionsBand;
  /** What the work cost — Claude Code spend over the page's date window. Owner-only, like `sessions`. */
  spend: SpendBand;
}

export type ReleasesData = OwnerReleasesData | PublicReleasesData;

/** One cell of the masthead's figure grid. */
export interface Tile {
  label: string;
  value: string;
  note?: string;
}
