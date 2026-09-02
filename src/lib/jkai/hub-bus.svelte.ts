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
  /**
   * Cost of each assistant turn in order, oldest first. The ledger draws it as
   * a bar per turn — the one reading that says whether a thread is getting more
   * expensive, which a running total cannot: a thread can double its spend
   * because it is long or because its last two turns were dear, and those want
   * different responses.
   */
  turnCostsUsd: number[];
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

/**
 * What the active thread is DOING, as opposed to what it is ABOUT.
 *
 * The thread inspector's Activity mode reads this. It lives on the bus for the
 * same reason the ledger does: the numbers are owned by the chat pane, the
 * surface that draws them is a sibling column, and the two must not be wired
 * through the page component — which would make every pane's activity flow
 * through one set of props and lose the "only the pane on screen publishes"
 * gate that keeps a background turn out of the chrome.
 *
 * Deliberately a SNAPSHOT of display-ready values, not a live handle on the
 * pane's state: the inspector must never be able to reach back into a
 * conversation's stream, and a flat shape is what makes the `untrack`ed publish
 * below safe to repeat on every token.
 */
export interface ThreadWorker {
  id: string;
  /** What the sub-agent was asked to do. */
  task: string;
  status: 'running' | 'done' | 'error';
  /** Its most recent tool step, already summarised. Null before its first. */
  step: string | null;
  startedAt: number | null;
}

export interface ThreadToolStep {
  id: string;
  /** Display name — `resolveDisplayTool` has already unwrapped any dispatcher. */
  tool: string;
  /** `categorizeTool`'s word (FILE, WEB, RUN…). Drives the row's colour. */
  category: string;
  status: 'running' | 'done' | 'error';
  summary: string | null;
  startedAt: number | null;
}

export interface ThreadActivity {
  /** A turn is in flight. */
  streaming: boolean;
  /** Sub-agents this turn spawned, running ones first. */
  workers: ThreadWorker[];
  /** Tool steps of the turn in flight, or of the last one that made any. */
  steps: ThreadToolStep[];
  /** Whether `steps` describes the turn in flight or a finished one. */
  stepsAreLive: boolean;
  /**
   * Id of the message those steps belong to. The inspector uses it to fetch the
   * recorded chain when a row is opened — `/api/jkai/trace/<id>` accepts a
   * message id as well as a trace id, which is what makes a reloaded thread
   * work. Null while a turn is in flight: the trace row is not written until the
   * turn ends, so there is nothing to fetch yet and the UI says so rather than
   * showing a 404.
   */
  stepsMessageId: string | null;
  /** A build this thread kicked off and is still watching. */
  build: { id: string; status: string } | null;
  /**
   * The recorded tool-call chain of the most recent turn that made any calls.
   *
   * Live steps are the good case; they are also the rare one, because a thread
   * reopened from history usually has only a `traceId` in its metadata and no
   * step array at all. Without this the Activity mode says "nothing has run in
   * this thread" about a thread that plainly ran six tools — so when the steps
   * are gone, the trace is what is offered instead. It is the durable record.
   */
  traceId: string | null;
}

const NO_ACTIVITY: ThreadActivity = {
  streaming: false,
  workers: [],
  steps: [],
  stepsAreLive: false,
  stepsMessageId: null,
  build: null,
  traceId: null,
};

const EMPTY: ThreadLedger = {
  contextTokens: null,
  contextFraction: null,
  threadCostUsd: null,
  turns: null,
  modelId: null,
  turnCostsUsd: [],
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
    /** Live picture of the on-screen thread's work in progress. Published by
     *  the chat pane, drawn by the thread inspector's Activity mode. */
    activity: ThreadActivity;
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
  activity: NO_ACTIVITY,
});

/** Publish the active thread's ledger. Pass a partial — omitted keys are left
 *  alone, explicit nulls clear. */
export function setThreadLedger(next: Partial<ThreadLedger>): void {
  Object.assign(hub, next);
}

/** Clear thread-scoped numbers (on unmount, or when no thread is selected). */
export function clearThreadLedger(): void {
  Object.assign(hub, EMPTY);
  hub.activity = NO_ACTIVITY;
}

/**
 * Publish the on-screen thread's work in progress. Whole-object replacement,
 * not a partial merge: every field describes the same instant, and merging half
 * of one snapshot into half of another is how you get "3 workers running" beside
 * an idle turn.
 */
export function setThreadActivity(next: ThreadActivity): void {
  hub.activity = next;
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
