// Shapes the daydream hub's chrome passes between the page and its components.
//
// In a .ts file rather than in each component's `<script lang="ts">`, for the
// same reason /health's `hub/types.ts` exists: a Svelte instance script is not
// a module you can import a type out of, so an interface declared there has to
// be redeclared everywhere it is used — and two copies of a tile's shape is
// how a `sub` field ends up optional on one side and required on the other.
import type { Tone } from '$lib/daydream/priority';

/** One tab in the sticky rail. */
export interface ShellTab {
  id: string;
  label: string;
  /** A real route. Every room of the daydream hub is its own page, so a tab
   *  is a link, never a `?tab=` state change — that was the same-route
   *  navigation trap. Optional only for the shell's other tenant
   *  (`/jkai/agents`), whose two tabs are still in-page state and go through
   *  `ontab`. */
  href?: string;
  /** Rendered as a pill count. Omit or `0` and nothing renders. */
  count?: number;
  /** Colours the count — `action` is the only one that shouts. */
  tone?: 'action' | 'watch' | 'quiet';
}

/** One tile in a `StatDeck`. */
export interface DeckTile {
  key: string;
  label: string;
  /** The big figure. A string, because half of these are `12/40` or `£8.20`. */
  value: string;
  /** The smaller trailing part of the figure — `/40`, `%`. */
  suffix?: string | null;
  sub?: string | null;
  tone?: Tone;
  /** Lit tiles get the accent frame — one per deck at most. */
  lit?: boolean;
}

/** One chip in a `FacetBar`. */
export interface Facet {
  id: string;
  label: string;
  /** Rendered muted after the label. `0` still renders — an empty facet is a
   *  fact, and hiding it makes a filter that returns nothing look broken. */
  count?: number | null;
}

/** One cell in a `RollupGrid` — a category with a figure, not a headline stat. */
export interface RollupCell {
  key: string;
  label: string;
  value: string;
  suffix?: string | null;
  /** One line under the figure; clamps at two. */
  sub?: string | null;
  tone?: Tone;
  /** Small mono text in the top-right corner — a delta, a stage, a unit. */
  corner?: string | null;
  /** A short series drawn as a sparkline along the bottom of the cell. */
  spark?: Array<number | null> | null;
  /** The cell is a link… */
  href?: string | null;
  /** …or a button. Neither: it is a plain figure. */
  onclick?: (() => void) | null;
  active?: boolean;
  /** The mono kicker before the label — a family mark, a stage. */
  mark?: string | null;
}

/** An axis of a `CategoryMatrix`. */
export interface MatrixAxis {
  id: string;
  label: string;
  /** Shown before the row label — the family mark. */
  mark?: string | null;
  tone?: Tone;
}

/** One row of a `FactList`. */
export interface FactRow {
  label: string;
  value: string;
  href?: string | null;
  tone?: Tone;
  /** Mono, for ids and stamps. */
  mono?: boolean;
}
