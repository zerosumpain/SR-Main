// Live state for the JKAI hub header's token strip.
//
// The header renders in /jkai/+layout.svelte so every surface wears it, but the
// numbers it shows are owned by whoever is doing the work: the chat page knows
// the active thread's context use and running cost, the layout load knows the
// day's totals. This bus is the seam — pages publish, the header reads.
//
// Everything is nullable and the strip drops any chunk it has no number for, so
// a surface that publishes nothing (intel, prompts) still gets a valid header.

export interface ThreadLedger {
  /** Tokens the active thread currently occupies in the model's window. */
  contextTokens: number | null;
  /** That as a fraction of the model's context window, 0–1. */
  contextFraction: number | null;
  /** Running USD cost of the active thread. */
  threadCostUsd: number | null;
  /** Turns exchanged in the active thread. */
  turns: number | null;
  /** Model id driving the active thread. */
  modelId: string | null;
}

/**
 * A surface-specific replacement for the header's `menu` dropdown.
 *
 * Surfaces like Intel carry a nav of their own — nine pages with their own
 * ordering — and rendering it as a horizontal strip under the header meant two
 * navigations stacked on top of each other before the page began. A surface
 * publishes its menu here and the header shows THAT instead, in the same place,
 * with a way back to chat beside it. Nothing new appears on screen.
 */
export interface PageMenuRow {
  label: string;
  href: string;
  /** Right-hand column: a count, a stage, a status word. */
  meta?: string;
  /** Hover text — what this destination is FOR. */
  title?: string;
  /** Reads as a backlog rather than a statistic; renders in the warn colour. */
  warn?: boolean;
}

export interface PageMenuGroup {
  heading: string;
  rows: PageMenuRow[];
}

export interface PageMenu {
  /** The chip's word — 'intel', 'canvas'. Lower case; the chip uppercases it. */
  label: string;
  groups: PageMenuGroup[];
  /** The way back out, rendered as its own chip beside the menu. */
  back?: { label: string; href: string };
}

const EMPTY: ThreadLedger = {
  contextTokens: null,
  contextFraction: null,
  threadCostUsd: null,
  turns: null,
  modelId: null,
};

export const hub = $state<
  ThreadLedger & {
    liveRuns: number | null;
    bpm: number | null;
    /** Header dropdown / phone sheet. Driven by both the header's `menu ▾`
     *  button and the phone tab bar's `≡ more` tab, hence shared state. */
    menuOpen: boolean;
    /** Set by a surface's layout to replace the header's menu. Null = the hub's. */
    pageMenu: PageMenu | null;
    /** Phone knowledge-graph bottom sheet (screen 2b): closed / peek / full. */
    graphSheet: 'closed' | 'peek' | 'full';
    /** Bumped whenever the active thread gains a completed turn. The knowledge-
     *  graph rail watches it so a thread that grew while you were looking at it
     *  redraws — without this the rail only ever loads on a thread switch, which
     *  is why it used to appear to need a navigation away and back. */
    graphRevision: number;
  }
>({
  ...EMPTY,
  // Client-observed overrides for values the layout load snapshotted at
  // navigation time. Null means "use the server's number".
  liveRuns: null,
  bpm: null,
  menuOpen: false,
  pageMenu: null,
  graphSheet: 'closed',
  graphRevision: 0,
});

/** Publish the active thread's ledger. Pass a partial — omitted keys are left
 *  alone, explicit nulls clear. */
export function setThreadLedger(next: Partial<ThreadLedger>): void {
  Object.assign(hub, next);
}

/** Clear thread-scoped numbers (on unmount, or when no thread is selected). */
export function clearThreadLedger(): void {
  Object.assign(hub, EMPTY);
}

export function setLiveRuns(n: number | null): void {
  hub.liveRuns = n;
}

export function setBpm(n: number | null): void {
  hub.bpm = n;
}

/**
 * Publish a surface menu. Also closes the dropdown: whatever was open belonged
 * to the previous surface, and leaving it open would show the new menu's rows
 * without the user having asked for them.
 */
export function setPageMenu(menu: PageMenu): void {
  hub.pageMenu = menu;
  hub.menuOpen = false;
}

export function clearPageMenu(): void {
  hub.pageMenu = null;
  hub.menuOpen = false;
}

export function toggleHubMenu(): void {
  hub.menuOpen = !hub.menuOpen;
}

export function closeHubMenu(): void {
  hub.menuOpen = false;
}

/** Cycle the phone graph sheet: closed → peek → full → closed. */
export function cycleGraphSheet(): void {
  hub.graphSheet = hub.graphSheet === 'closed' ? 'peek' : hub.graphSheet === 'peek' ? 'full' : 'closed';
}

export function closeGraphSheet(): void {
  hub.graphSheet = 'closed';
}

/** Signal that the active thread's knowledge graph may have changed. */
export function bumpGraphRevision(): void {
  hub.graphRevision += 1;
}
