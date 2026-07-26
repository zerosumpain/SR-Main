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
    /** Phone knowledge-graph bottom sheet (screen 2b): closed / peek / full. */
    graphSheet: 'closed' | 'peek' | 'full';
  }
>({
  ...EMPTY,
  // Client-observed overrides for values the layout load snapshotted at
  // navigation time. Null means "use the server's number".
  liveRuns: null,
  bpm: null,
  menuOpen: false,
  graphSheet: 'closed',
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
